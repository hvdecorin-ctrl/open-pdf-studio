use anyhow::{Context, Result};
use memmap2::{MmapMut, MmapOptions};
use std::fs::OpenOptions;
use std::path::Path;

pub const SHM_SIZE: usize = 64 * 1024 * 1024; // 64 MB per worker
pub const HEADER_SIZE: usize = 32;

pub struct Shm {
    mmap: MmapMut,
    pub path: String,
}

impl Shm {
    /// Create (or replace) the SHM backing file under the OS temp dir.
    /// File name is `pdfium-worker-{slot}.shm` so main and worker can
    /// memmap the same path.
    pub fn create(slot: u32) -> Result<Self> {
        let path = format!(
            "{}/pdfium-worker-{}.shm",
            std::env::temp_dir().to_string_lossy(),
            slot
        );
        let file = OpenOptions::new()
            .read(true).write(true).create(true).truncate(true)
            .open(&path)
            .with_context(|| format!("open SHM file {}", path))?;
        file.set_len(SHM_SIZE as u64)
            .context("set SHM file length")?;
        let mmap = unsafe {
            MmapOptions::new().len(SHM_SIZE).map_mut(&file)
                .context("mmap SHM file")?
        };
        Ok(Self { mmap, path })
    }

    /// Write width + height to header, copy rgba into payload starting at
    /// offset HEADER_SIZE. Returns total payload bytes written.
    pub fn write_bitmap(&mut self, width: u32, height: u32, rgba: &[u8]) -> Result<u64> {
        if rgba.len() + HEADER_SIZE > SHM_SIZE {
            anyhow::bail!(
                "bitmap too large for SHM: {} bytes > {} (cap)",
                rgba.len(), SHM_SIZE - HEADER_SIZE
            );
        }
        self.mmap[0..4].copy_from_slice(&width.to_le_bytes());
        self.mmap[4..8].copy_from_slice(&height.to_le_bytes());
        // zero-fill the rest of the header (slots 8..32 reserved)
        for i in 8..HEADER_SIZE { self.mmap[i] = 0; }
        let end = HEADER_SIZE + rgba.len();
        self.mmap[HEADER_SIZE..end].copy_from_slice(rgba);
        self.mmap.flush_async()
            .context("flush SHM after write")?;
        Ok(rgba.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_header() {
        let mut shm = Shm::create(999).unwrap();
        let rgba = vec![0xAB; 1000];
        let bytes = shm.write_bitmap(123, 456, &rgba).unwrap();
        assert_eq!(bytes, 1000);
        // Re-read the file from disk and verify header
        let file_bytes = std::fs::read(&shm.path).unwrap();
        assert_eq!(u32::from_le_bytes([file_bytes[0], file_bytes[1], file_bytes[2], file_bytes[3]]), 123);
        assert_eq!(u32::from_le_bytes([file_bytes[4], file_bytes[5], file_bytes[6], file_bytes[7]]), 456);
        assert_eq!(file_bytes[HEADER_SIZE + 500], 0xAB);
    }

    #[test]
    fn write_too_large_returns_err() {
        let mut shm = Shm::create(998).unwrap();
        let huge = vec![0u8; SHM_SIZE];
        let r = shm.write_bitmap(1, 1, &huge);
        assert!(r.is_err());
    }
}
