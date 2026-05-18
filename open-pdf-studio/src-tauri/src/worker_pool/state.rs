use std::sync::atomic::{AtomicUsize, AtomicU8, Ordering};
use std::sync::Arc;
use tokio::io::{BufReader, AsyncBufReadExt};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use memmap2::Mmap;

/// Status of a single worker slot.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Status {
    Spawning = 0,
    Ready = 1,
    Dead = 2,
    DeadPermanent = 3,
}

pub struct WorkerState {
    pub slot: u32,
    pub status: AtomicU8,
    pub queue_depth: AtomicUsize,
    pub child: Arc<Mutex<Option<Child>>>,
    pub stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub stdout: Arc<Mutex<Option<BufReader<ChildStdout>>>>,
    pub shm: Arc<Mutex<Option<Mmap>>>,
    pub crashes: AtomicUsize,
    pub last_crash_at: Arc<Mutex<Option<std::time::Instant>>>,
}

impl WorkerState {
    pub fn new(slot: u32) -> Self {
        Self {
            slot,
            status: AtomicU8::new(Status::Spawning as u8),
            queue_depth: AtomicUsize::new(0),
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            stdout: Arc::new(Mutex::new(None)),
            shm: Arc::new(Mutex::new(None)),
            crashes: AtomicUsize::new(0),
            last_crash_at: Arc::new(Mutex::new(None)),
        }
    }

    pub fn status(&self) -> Status {
        match self.status.load(Ordering::Acquire) {
            1 => Status::Ready,
            2 => Status::Dead,
            3 => Status::DeadPermanent,
            _ => Status::Spawning,
        }
    }

    pub fn set_status(&self, s: Status) {
        self.status.store(s as u8, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_status_is_spawning() {
        let w = WorkerState::new(0);
        assert_eq!(w.status(), Status::Spawning);
    }

    #[test]
    fn status_transitions() {
        let w = WorkerState::new(0);
        w.set_status(Status::Ready);
        assert_eq!(w.status(), Status::Ready);
        w.set_status(Status::Dead);
        assert_eq!(w.status(), Status::Dead);
    }

    #[test]
    fn queue_depth_atomic_increments() {
        let w = WorkerState::new(0);
        w.queue_depth.fetch_add(1, Ordering::Release);
        w.queue_depth.fetch_add(1, Ordering::Release);
        assert_eq!(w.queue_depth.load(Ordering::Acquire), 2);
    }
}
