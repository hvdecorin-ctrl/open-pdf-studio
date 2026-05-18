mod protocol;
mod render;
mod shm;

use anyhow::{Context, Result};
use protocol::{Request, Response};
use render::Renderer;
use shm::Shm;
use std::io::{BufRead, Write};

fn main() -> Result<()> {
    // Slot is passed as argv[1] (set by the spawner). Default to 0 for
    // standalone testing.
    let slot: u32 = std::env::args().nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let renderer = Renderer::new().context("init Renderer")?;
    let mut shm_region = Shm::create(slot).context("init SHM")?;

    // Emit ready message — main process waits for this before
    // sending render requests.
    let ready = Response::Ready {
        op: "ready".to_string(),
        shm_name: format!("pdfium-worker-{}.shm", slot),
        shm_size: shm::SHM_SIZE as u64,
    };
    writeln!(std::io::stdout(), "{}", serde_json::to_string(&ready)?)?;
    std::io::stdout().flush()?;

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[worker {}] stdin read error: {}", slot, e);
                break;
            }
        };
        if line.trim().is_empty() { continue; }

        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[worker {}] bad request: {}", slot, e);
                continue;
            }
        };

        match req {
            Request::Render { id, path, page_index, scale, rotation } => {
                let resp = match renderer.render(&path, page_index, scale, rotation) {
                    Ok(result) => {
                        match shm_region.write_bitmap(result.width, result.height, &result.rgba) {
                            Ok(bytes) => Response::RenderOk {
                                id, ok: true,
                                w: result.width, h: result.height,
                                shm_bytes: bytes,
                            },
                            Err(e) => Response::RenderErr {
                                id, ok: false,
                                error: format!("SHM write: {}", e),
                            },
                        }
                    }
                    Err(e) => Response::RenderErr {
                        id, ok: false,
                        error: format!("{}", e),
                    },
                };
                writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
                stdout.flush()?;
            }
            Request::Shutdown => {
                eprintln!("[worker {}] shutting down", slot);
                break;
            }
        }
    }

    Ok(())
}
