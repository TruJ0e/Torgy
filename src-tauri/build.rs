use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{fs, path::Path};

const ICON_PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAD1UlEQVR42u3cMU4yURiG0eGGBpcie4KChsLORNegiZ0FDQXUGhPiVoY1UNJQY21jggHmMu85G/Cf+fme+e4UMzjsd8cGiFTcAhAAQAAAAQAEABAAQAAAAQAEABAAQAAAAQAEABAAQAAAAQAEAKjHMO2CZ9OJ/3X+tFytY6510OdPghl2RCEoAAYeQQgMgMFHCMICYOgRg8AAGHyEIDAABh8hOL9i+CH3d1v1BmDwsQ2EbgCGH9tAaAAMPyIQeAQw+DgShG4Ahh/bQGgADD8iEBoAw48IhAbA8EO3c1AMP+RGoBh+yI2AT4JBsKsHwNMf6pmPYvghNwLF8ENuBLwDAO8APP0hcQsohh9yI+AIAI4Anv6QuAXYAMAG4OkPiVuADQBsAIAAWP8h6hhgAwAbgKc/JG4BNgCwAQACAAiA8z9kvAewAYANABAAQAAAATiJF4BwPeeaNxsA2AAAAQAEABAAQAAAAQAEABAAQAAAAQAEABAAQAAAAQAEABAAQAAAAQAEABAAQAAAAQAEABAAQAAAAQAEABAAEABAAAABAAQAEABAAAABAAQAEABAAAABAAQAEABAAAABAAQAEABAAAABAAQAEABAAAABAAQAEABAAAABAAQAEABAAAABAAQAEABAAAABAAQAEAAQAEAAAAEABAAQAEAAAAEABAAQAEAAAAEABAAQAEAAgIAALFdrdxOu5FzzZgMAGwAgAIAAAAJwMi8C4fLOOWc2ALABAImGbkE/PMznbgLdbwDeA8BtnP8dAcAGUH+lgMvMlQ0AbACAADgGQMz6bwMAG8DtVQs8/W0AQO0BsAVAvfNT+nARYPgdAYBaA2ALgPrmpfTxosDwV3oEEAGoZz68AwDvAGwBkPb073QDEAHofh5K4kWD4a/kHYAIYPib3ACIAIY/PAAigOHvxuCw3x1ruzmz6cQvBIOftAHYBjD8AiACGP70I4AjAQY/fAOwDWD4bQC2AQy+AAgBBl8AxABDLwBCgMEXAEHAwAuAKGDYBQA4mU+CgQAAAgAIACAAgAAAAgAIACAAgAAAAgAIACAAgAAAAgAIAFCfH0fQAjpkT7VRAAAAAElFTkSuQmCC";

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
