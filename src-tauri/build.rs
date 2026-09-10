use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{fs, path::Path};

const ICON_PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAE60lEQVR4nO3dMU5cSxBA0ccXW4SE9ZHA0hxZcu4fjYxkLIOB6ep3z9kArVbVpUEjzc2P799+HkDSf6sPAKwjABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABB2u/oAqz3c360+Aos9Pj2vPsIyN6UvB7XsvFUlCqcPgKXno84cg9MGwOLz2c4YgtMFwOLz1c4UgtMEwOJzbWcIwfYBsPistnMItv4cgOVngp3ncMsXwM4Xzrnt9hrY7gVg+Zlst/ncKgC7XS5NO83pNgHY6VJhl3ndIgC7XCa8tMPcjg/ADpcIfzJ9fkcHYPrlwVtMnuOxAZh8afBeU+d5ZACmXhZ8xMS5HheAiZcEn2XafI8LAHA9owIwrY7wFSbN+ZgATLoU+GpT5n1MAIDrGxGAKTWEa5ow9yMCAKyxPAATKgirrJ7/5QEA1lkagNX1gwlW7oEXAIQtC4Df/vDLqn3wAoAwAYCwJQHw/IffrdgLLwAIEwAIEwAIEwAIu3oA/AMQ/uza++EFAGECAGECAGECAGECAGECAGECAGG3qw+wm8en59VH4C981uTtvAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgzJeDvtPUL55c8aWlU++Ct/MCgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgLDb1Qfgczzc360+AhvyAoAwAYAwAYCwqwfg8en52j8StnHt/fACgDABgDABgDABgLAlAfCPQPjdir3wAoAwAYCwZQHwZwD8smofvAAgbGkAvAJg7R54AUDY8gB4BVC2ev6XBwBYZ0QAVlcQVpgw9yMCAKwxJgATagjXMmXexwTgOOZcCnylSXM+KgDAdY0LwKQ6wmebNt/jAnAc8y4JPsPEuR4ZgOOYeVnwr6bO89gAHMfcS4P3mDzHowNwHLMvD/5m+vyOD8BxzL9EeM0Oc7tFAI5jj8uEi13mdZsAHMc+l0rbTnO6VQCOY6/LpWe3+bz58f3bz9WH+FcP93erjwDHcey3+BfbvQBe2vXSOZed53DrF8BLXgNc286Lf3GaAFwIAV/tDIt/cboAXAgBn+1Mi39x2gBcCAEfdcbFvzh9AF4SA97qzEv/UioArxEFKsv+mnwAoGzrzwEAHyMAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAEPY/w6Xf9WmT+fEAAAAASUVORK5CYII=";

fn ensure_windows_icon() {
    if !cfg!(target_os = "windows") {
        return;
    }

    let png = STANDARD.decode(ICON_PNG_B64).expect("decode embedded icon PNG");
    let mut ico = Vec::with_capacity(22 + png.len());

    ico.extend_from_slice(&0u16.to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());

    ico.push(0); // 256px width
    ico.push(0); // 256px height
    ico.push(0); // palette
    ico.push(0); // reserved
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&32u16.to_le_bytes());
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(&png);

    let path = Path::new("icons/icon.ico");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create icon directory");
    }
    fs::write(path, ico).expect("write compatible Windows icon");
}

fn main() {
    ensure_windows_icon();
    tauri_build::build()
}
