use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

fn snapshot(code: &str, state: &str, current: i64, target: i64) -> Value {
    json!({"tasks":[{"task_code":code,"accept_status":state,
        "progress":{"current":current,"target":target}}]})
}

#[tokio::test]
async fn acceptance_uses_matching_platform_for_every_action_code() {
    // In particular, all ten ordinary codes from failed startup run 6489 must
    // never receive X-Client-Platform: miniprogram.
    for &code in ACTION_ORDER {
        let writes = Arc::new(AtomicUsize::new(0));
        let n = writes.clone();
        let service = BillingService::mock_headers(move |url, body, headers| {
            assert_eq!(headers.iter().any(|(k,v)| k.eq_ignore_ascii_case("X-Client-Platform") && v == "miniprogram"), is_mp_task_code(code), "{code}");
            assert!(url.starts_with(CHAT_BASE));
            if url.ends_with("/accept") {
                assert_eq!(body.unwrap()["task_codes"], json!([code]));
                n.fetch_add(1, Ordering::Relaxed);
                // Upstream can omit individual acknowledgement status.
                Ok(json!({}))
            } else {
                assert!(url.ends_with("/tasks"));
                Ok(snapshot(
                    code,
                    if n.load(Ordering::Relaxed) == 0 {
                        "not_accepted"
                    } else {
                        "accepted"
                    },
                    0,
                    5,
                ))
            }
        });
        assert_eq!(
            accept_verified_task(&service, &json!({}), code)
                .await
                .unwrap()
                .accept_status,
            "accepted"
        );
        assert_eq!(writes.load(Ordering::Relaxed), 1);
    }
}

#[tokio::test]
async fn delayed_registration_polls_without_reposting() {
    let writes = Arc::new(AtomicUsize::new(0));
    let n = writes.clone();
    let reads = Arc::new(AtomicUsize::new(0));
    let r = reads.clone();
    let service = BillingService::mock(move |url, _| {
        if url.ends_with("/accept") {
            n.fetch_add(1, Ordering::Relaxed);
            Ok(json!({"results":[{"status":"accepted"}]}))
        } else {
            let read = r.fetch_add(1, Ordering::Relaxed);
            if read == 1 {
                return Err(BillingError::new("fixture read timeout", 504));
            }
            Ok(snapshot(
                "chat_5",
                if read < 3 { "not_accepted" } else { "accepted" },
                4,
                5,
            ))
        }
    });
    let task = accept_verified_task(&service, &json!({}), "chat_5")
        .await
        .unwrap();
    assert_eq!(task.current, 4);
    assert_eq!(reads.load(Ordering::Relaxed), 4);
    assert_eq!(writes.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn lost_write_response_is_reconciled_without_retry() {
    let calls = Arc::new(AtomicUsize::new(0));
    let n = calls.clone();
    let service = BillingService::mock(move |url, _| {
        if url.ends_with("/accept") {
            n.fetch_add(1, Ordering::Relaxed);
            Err(BillingError::new("fixture write timeout", 504))
        } else {
            Ok(snapshot(
                "chat_5",
                if n.load(Ordering::Relaxed) == 0 {
                    "not_accepted"
                } else {
                    "accepted"
                },
                0,
                5,
            ))
        }
    });
    assert!(accept_verified_task(&service, &json!({}), "chat_5")
        .await
        .is_ok());
    assert_eq!(calls.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn only_explicit_unregistered_state_allows_one_bounded_retry() {
    let calls = Arc::new(AtomicUsize::new(0));
    let n = calls.clone();
    let service = BillingService::mock(move |url, _| {
        if url.ends_with("/accept") {
            n.fetch_add(1, Ordering::Relaxed);
            Ok(json!({}))
        } else {
            Ok(snapshot("chat_5", "not_accepted", 0, 5))
        }
    });
    let error = accept_verified_task(&service, &json!({}), "chat_5")
        .await
        .unwrap_err();
    assert!(error.message.contains("仍未登记"));
    assert_eq!(calls.load(Ordering::Relaxed), 2);
}

#[tokio::test]
async fn uncertain_reads_never_allow_actions_or_another_write() {
    for state in ["", "unexpected", "missing", "error"] {
        let calls = Arc::new(AtomicUsize::new(0));
        let n = calls.clone();
        let service = BillingService::mock(move |url, _| {
            if url.ends_with("/accept") {
                n.fetch_add(1, Ordering::Relaxed);
                return Ok(json!({}));
            }
            assert!(url.ends_with("/tasks"), "must not execute or claim");
            if n.load(Ordering::Relaxed) == 0 {
                return Ok(snapshot("chat_5", "not_accepted", 0, 5));
            }
            match state {
                "missing" => Ok(json!({"tasks":[]})),
                "error" => Err(BillingError::new("fixture read timeout", 504)),
                other => Ok(snapshot("chat_5", other, 0, 5)),
            }
        });
        let result =
            crate::providers::workbuddy::legacy_workbuddy::task_execution::execute(&service, &json!({}), "chat_5", "full")
                .await;
        assert_eq!(result.outcome, "failed", "{state}");
        assert!(result.message.contains("接受任务未确认生效"));
        assert_eq!(calls.load(Ordering::Relaxed), 1, "{state}");
    }
}

#[tokio::test]
async fn terminal_snapshot_is_authoritative_without_accepting_again() {
    for state in ["accepted", "in_progress", "completed", "claimed"] {
        let service = BillingService::mock(move |url, _| {
            assert!(url.ends_with("/tasks"), "already registered: no write");
            Ok(snapshot("chat_5", state, 0, 0))
        });
        let task = accept_verified_task(&service, &json!({}), "chat_5")
            .await
            .unwrap();
        assert_eq!(task.accept_status, state);
        assert_eq!(task.claimable, state == "completed");
        assert_eq!(task.claimed, state == "claimed");
    }
}

#[tokio::test]
async fn stopped_during_acceptance_never_sends_another_request() {
    use crate::providers::workbuddy::legacy_workbuddy::task_execution::{Control, CONTROL};
    use std::sync::atomic::AtomicBool;
    let stop = Arc::new(AtomicBool::new(false));
    let marker = stop.clone();
    let service = BillingService::mock(move |url, _| {
        if url.ends_with("/accept") {
            marker.store(true, Ordering::Relaxed);
            Ok(json!({}))
        } else {
            assert!(!marker.load(Ordering::Relaxed));
            Ok(snapshot("chat_5", "not_accepted", 0, 5))
        }
    });
    let result = CONTROL
        .scope(
            Control {
                stop,
                kind: "growth".into(),
                automatic: false,
                run_id: 0,
            },
            crate::providers::workbuddy::legacy_workbuddy::task_execution::execute(&service, &json!({}), "chat_5", "full"),
        )
        .await;
    assert_eq!(result.outcome, "cancelled");
}

#[tokio::test]
async fn fresh_progress_limits_actions_and_claimed_snapshot_skips_them() {
    for already_claimed in [false, true] {
        let writes = Arc::new(AtomicUsize::new(0));
        let reports = Arc::new(AtomicUsize::new(0));
        let n = writes.clone();
        let r = reports.clone();
        let service = BillingService::mock(move |url, _| {
            if url.ends_with("/accept") {
                n.fetch_add(1, Ordering::Relaxed);
                return Ok(json!({}));
            }
            if url.ends_with("/v2/report") {
                r.fetch_add(1, Ordering::Relaxed);
                return Ok(json!({}));
            }
            assert!(
                url.ends_with("/tasks"),
                "never contact a real model or reward endpoint"
            );
            Ok(if n.load(Ordering::Relaxed) == 0 {
                snapshot("chat_5", "not_accepted", 0, 5)
            } else if already_claimed || r.load(Ordering::Relaxed) > 0 {
                snapshot("chat_5", "claimed", 5, 5)
            } else {
                snapshot("chat_5", "accepted", 4, 5)
            })
        });
        let result =
            crate::providers::workbuddy::legacy_workbuddy::task_execution::execute(&service, &json!({}), "chat_5", "full")
                .await;
        assert_eq!(result.outcome, "already");
        assert_eq!(
            reports.load(Ordering::Relaxed),
            if already_claimed { 0 } else { 1 }
        );
        assert_eq!(writes.load(Ordering::Relaxed), 1);
    }
}

#[tokio::test]
async fn claim_only_never_accepts_or_runs_a_task() {
    let service = BillingService::mock(|url, _| {
        assert!(url.ends_with("/tasks"));
        Ok(snapshot("chat_5", "not_accepted", 0, 5))
    });
    assert_eq!(
        crate::providers::workbuddy::legacy_workbuddy::task_execution::execute(&service, &json!({}), "chat_5", "claim")
            .await
            .outcome,
        "skipped"
    );
}

#[tokio::test]
async fn legacy_json_route_uses_readback_even_without_ack_status() {
    let reads = Mutex::new(0);
    let result = super::super::growth_accept::confirm(
        || async { Ok(()) },
        || async {
            let mut n = reads.lock().unwrap();
            *n += 1;
            Ok(json!({"accept_status":if *n == 1 {"not_accepted"} else {"accepted"}}))
        },
        |value| value["accept_status"].as_str().unwrap_or(""),
    )
    .await
    .unwrap();
    assert_eq!(result["accept_status"], "accepted");
}

#[tokio::test]
async fn scan_and_execution_prefer_mp_state_over_stale_default_duplicate() {
    let service = BillingService::mock_headers(|_, _, headers| {
        let mp = headers
            .iter()
            .any(|(k, v)| k.eq_ignore_ascii_case("X-Client-Platform") && v == "miniprogram");
        Ok(json!({"tasks":[
            {"task_code":"Sequential_Tasks_1","accept_status":if mp {"accepted"} else {"claimed"}},
            {"task_code":"chat_5","accept_status":if mp {"not_accepted"} else {"accepted"}}
        ]}))
    });
    let tasks = list_tasks_merged(&service, &json!({})).await.unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(tasks.iter().all(|task| task.accept_status == "accepted"));
    assert_eq!(
        task_by_code(&service, &json!({}), "Sequential_Tasks_1")
            .await
            .unwrap()
            .unwrap()
            .accept_status,
        "accepted"
    );
}

#[tokio::test]
async fn invalid_preflight_never_writes() {
    for state in ["", "unknown", "missing", "error", "locked"] {
        let service = BillingService::mock(move |url, _| {
            assert!(url.ends_with("/tasks"), "uncertain preflight must not POST");
            match state {
                "missing" => Ok(json!({"tasks":[]})),
                "error" => Err(BillingError::new("fixture read failed", 504)),
                "locked" => Ok(
                    json!({"tasks":[{"task_code":"chat_5","accept_status":"not_accepted","locked":true}]}),
                ),
                other => Ok(snapshot("chat_5", other, 0, 5)),
            }
        });
        assert!(accept_verified_task(&service, &json!({}), "chat_5")
            .await
            .is_err());
    }
}

#[tokio::test]
async fn rejected_or_uncertain_write_is_not_retried_without_confirmation() {
    for status in [400, 401, 429, 504] {
        let writes = Arc::new(AtomicUsize::new(0));
        let n = writes.clone();
        let service = BillingService::mock(move |url, _| {
            if url.ends_with("/accept") {
                n.fetch_add(1, Ordering::Relaxed);
                Err(BillingError::new("fixture rejection or timeout", status))
            } else {
                Ok(snapshot("chat_5", "not_accepted", 0, 5))
            }
        });
        let error = accept_verified_task(&service, &json!({}), "chat_5")
            .await
            .unwrap_err();
        assert_eq!(error.status_code, status);
        assert_eq!(writes.load(Ordering::Relaxed), 1);
    }
}

#[tokio::test]
async fn accepting_may_settle_directly_into_in_progress() {
    let writes = Arc::new(AtomicUsize::new(0));
    let n = writes.clone();
    let service = BillingService::mock(move |url, _| {
        if url.ends_with("/accept") {
            n.fetch_add(1, Ordering::Relaxed);
            Ok(json!({}))
        } else {
            Ok(snapshot("Sequential_Tasks_3", if n.load(Ordering::Relaxed) == 0 { "not_accepted" } else { "in_progress" }, 1, 5))
        }
    });
    let task = accept_verified_task(&service, &json!({}), "Sequential_Tasks_3").await.unwrap();
    assert!(task.is_registered());
    assert_eq!(task.current, 1);
    assert!(!task.claimable);
    assert_eq!(writes.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn canonical_executor_continues_in_progress_without_accepting_again() {
    let reports = Arc::new(AtomicUsize::new(0));
    let count = reports.clone();
    let service = BillingService::mock(move |url, _| {
        if url.ends_with("/v2/report") {
            count.fetch_add(1, Ordering::Relaxed);
            return Ok(json!({}));
        }
        assert!(url.ends_with("/tasks"), "must not re-register or send another reward/model request");
        Ok(if count.load(Ordering::Relaxed) == 0 {
            snapshot("chat_5", "in_progress", 4, 5)
        } else {
            snapshot("chat_5", "claimed", 5, 5)
        })
    });
    let result = crate::providers::workbuddy::legacy_workbuddy::task_execution::execute(&service, &json!({}), "chat_5", "full").await;
    assert_eq!(result.outcome, "already");
    assert_eq!(reports.load(Ordering::Relaxed), 1);
}
