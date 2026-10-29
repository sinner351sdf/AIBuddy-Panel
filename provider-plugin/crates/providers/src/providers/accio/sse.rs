//! Byte-based SSE event assembly. Never split UTF-8 at transport boundaries.
//! Consumers receive compact data records only after a whole event is available.
use super::chat::MAX_FRAME_BYTES;

#[derive(Default, Debug)]
pub(super) struct Event {
    pub data: Option<String>,
    pub event: Option<String>,
    pub comments: u64,
    pub controls: u64,
    pub unknown: u64,
    pub has_id: bool,
    pub has_retry: bool,
}

#[derive(Default)]
pub(super) struct Decoder {
    line: Vec<u8>,
    event: Event,
    bytes: usize,
    after_cr: bool,
    started: bool,
    failure: Option<&'static str>,
}

impl Decoder {
    pub fn take_error(&mut self) -> Option<&'static str> {
        self.failure.take()
    }

    pub fn pending_len(&self) -> usize {
        self.bytes
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Event>, &'static str> {
        let mut events = Vec::new();
        for &byte in bytes {
            if self.after_cr {
                self.after_cr = false;
                if byte == b'\n' {
                    continue;
                }
            }
            self.bytes += 1;
            if self.bytes > MAX_FRAME_BYTES {
                if events.is_empty() {
                    return Err("SSE event exceeds size limit");
                }
                self.failure = Some("SSE event exceeds size limit");
                return Ok(events);
            }
            if byte == b'\r' || byte == b'\n' {
                self.after_cr = byte == b'\r';
                match self.end_line() {
                    Ok(Some(event)) => events.push(event),
                    Ok(None) => {}
                    Err(error) if events.is_empty() => return Err(error),
                    Err(error) => {
                        self.failure = Some(error);
                        return Ok(events);
                    }
                }
            } else {
                self.line.push(byte);
            }
        }
        Ok(events)
    }

    fn end_line(&mut self) -> Result<Option<Event>, &'static str> {
        let bytes = std::mem::take(&mut self.line);
        let mut line = std::str::from_utf8(&bytes).map_err(|_| "Invalid SSE UTF-8")?;
        if !self.started {
            line = line.trim_start_matches('\u{feff}');
            self.started = true;
        }
        if line.is_empty() {
            self.bytes = 0;
            return Ok(Some(std::mem::take(&mut self.event)));
        }
        if line.starts_with(':') {
            self.event.comments += 1;
            return Ok(None);
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "data" => {
                if let Some(data) = &mut self.event.data {
                    data.push('\n');
                    data.push_str(value);
                } else {
                    self.event.data = Some(value.to_owned());
                }
            }
            "event" => {
                self.event.event = Some(value.to_owned());
                self.event.controls += 1;
            }
            "id" => {
                self.event.has_id |= !value.contains('\0');
                self.event.controls += 1;
            }
            "retry" => {
                self.event.has_retry |=
                    !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit());
                self.event.controls += 1;
            }
            _ => self.event.unknown += 1,
        }
        Ok(None)
    }

    /// ADK also dispatches an unterminated event at clean EOF. Never call on cancel.
    pub fn finish(&mut self) -> Result<Option<Event>, &'static str> {
        if !self.line.is_empty() {
            self.end_line()?;
        }
        if self.bytes == 0 {
            return Ok(None);
        }
        self.bytes = 0;
        Ok(Some(std::mem::take(&mut self.event)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_byte_splits_support_bom_crlf_multiline_and_controls() {
        let input = "\u{feff}: ping\r\nid: opaque\r\nretry: 100\r\nevent: message\r\ndata: {\r\ndata: \"text\":\"中文🙂\"}\r\n\r\n".as_bytes();
        for split in 0..=input.len() {
            let mut parser = Decoder::default();
            let mut events = parser.push(&input[..split]).unwrap();
            events.extend(parser.push(&input[split..]).unwrap());
            assert_eq!(events.len(), 1, "split {split}");
            assert_eq!(events[0].data.as_deref(), Some("{\n\"text\":\"中文🙂\"}"));
            assert_eq!(events[0].comments, 1);
            assert!(events[0].has_id && events[0].has_retry);
            assert_eq!(parser.pending_len(), 0);
        }
    }
    #[test]
    fn eof_cr_and_empty_fields() {
        let mut parser = Decoder::default();
        let events = parser
            .push(b"data\rdata: second\r\rid: a\0b\nretry: bad\n\n")
            .unwrap();
        assert_eq!(events[0].data.as_deref(), Some("\nsecond"));
        assert!(!events[1].has_id && !events[1].has_retry);
        parser.push(b"data: [DONE]").unwrap();
        assert_eq!(
            parser.finish().unwrap().unwrap().data.as_deref(),
            Some("[DONE]")
        );
        assert!(parser.finish().unwrap().is_none());
    }
}
