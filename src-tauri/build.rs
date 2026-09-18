use ico::{IconDir, IconDirEntry, IconImage, ResourceType};
use std::{fs, fs::File, path::Path};

fn icon_rgba(size: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let pad = (size / 8).max(1);
    let top = (size / 4).max(1);
    let bar = (size / 7).max(1);
    let stem = (size / 6).max(1);
    let stem_left = (size - stem) / 2;
    let stem_right = stem_left + stem;

    for y in 0..size {
        for x in 0..size {
            let i = ((y * size + x) * 4) as usize;

            // Warm neutral background with a small transparent margin.
            if x < pad || y < pad || x >= size - pad || y >= size - pad {
                rgba[i..i + 4].copy_from_slice(&[0, 0, 0, 0]);
                continue;
            }

            rgba[i..i + 4].copy_from_slice(&[245, 242, 236, 255]);

            // Simple dark T mark for Torgy.
            let in_top_bar = y >= top && y < top + bar && x >= size / 4 && x < 3 * size / 4;
            let in_stem = y >= top && y < 3 * size / 4 && x >= stem_left && x < stem_right;
            if in_top_bar || in_stem {
                rgba[i..i + 4].copy_from_slice(&[70, 66, 61, 255]);
            }
        }
    }

    rgba
}

fn ensure_windows_icon() {
    if !cfg!(target_os = "windows") {
        return;
    }

    let path = Path::new("icons/icon.ico");
    if path.exists() {
        return;
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create icon directory");
    }

    let mut dir = IconDir::new(ResourceType::Icon);
    for size in [16u32, 24, 32, 48, 64, 128, 256] {
        let image = IconImage::from_rgba_data(size, size, icon_rgba(size));
        let entry = IconDirEntry::encode_as_png(&image).expect("encode Windows icon frame as PNG");
        dir.add_entry(entry);
    }

    let file = File::create(path).expect("create Windows icon");
    dir.write(file).expect("write Windows icon");
}

fn main() {
    ensure_windows_icon();
    tauri_build::build()
}
