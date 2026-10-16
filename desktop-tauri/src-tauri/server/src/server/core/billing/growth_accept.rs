//! Acceptance confirms registration only; it never runs task actions or rewards.
use super::BillingError;
use std::{future::Future, time::Duration};

fn stopped() -> Result<(), BillingError> {
    if crate::server::core::task_execution::should_stop() {
        Err(BillingError::new("任务已停止，未发送后续请求", 409))
    } else {
        Ok(())
    }
}

fn registered(status: &str) -> bool {
    matches!(status, "accepted" | "completed" | "claimed")
}

/// Read and write closures must use the same task code and platform. A fresh,
/// explicit not_accepted is required before each write. Uncertain reads never
/// trigger another POST. Registration acknowledgements alone are insufficient.
pub(crate) async fn confirm<T, W, WF, R, RF, S>(
    mut write: W,
    mut read: R,
    status: S,
) -> Result<T, BillingError>
where
    W: FnMut() -> WF,
    WF: Future<Output = Result<(), BillingError>>,
    R: FnMut() -> RF,
    RF: Future<Output = Result<T, BillingError>>,
    S: Fn(&T) -> &str,
{
    stopped()?;
    let before = read().await?;
    stopped()?;
    if registered(status(&before)) {
        return Ok(before);
    }
    if status(&before) != "not_accepted" {
        return Err(BillingError::new(
            "接受任务前状态不明确，未发送接受请求",
            409,
        ));
    }
    for attempt in 0..2 {
        stopped()?;
        let write_error = write().await.err();
        let mut last_error = BillingError::new("接受任务后仍未登记，未执行后续动作", 409);
        let mut retry_safe = false;
        // Give asynchronous registration time to settle, without resending the
        // write on a timeout, missing task, or unknown status.
        for _ in 0..3 {
            tokio::time::sleep(Duration::from_millis(if cfg!(test) { 0 } else { 2_000 })).await;
            stopped()?;
            retry_safe = false;
            let snapshot = read().await;
            stopped()?;
            match snapshot {
                Ok(task) if registered(status(&task)) => return Ok(task),
                Ok(task) if status(&task) == "not_accepted" => {
                    retry_safe = true;
                    last_error = BillingError::new("接受任务后仍未登记，未执行后续动作", 409);
                }
                Ok(_) => {
                    last_error = BillingError::new("接受任务回读状态不明确，未执行后续动作", 502);
                }
                Err(error) if matches!(error.status_code, 401 | 403) => return Err(error),
                Err(error) => last_error = error,
            }
        }
        if let Some(error) = write_error {
            // Even a failed/timeout response can have committed. Read first,
            // then surface the error; do not retry an uncertain write.
            return Err(error);
        }
        if attempt == 1 || !retry_safe {
            return Err(last_error);
        }
    }
    Err(BillingError::new("接受任务确认预算已耗尽", 409))
}
