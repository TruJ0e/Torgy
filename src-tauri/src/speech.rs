use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechResult {
    pub text: String,
    pub confidence: Option<f32>,
    pub engine: String,
}

#[cfg(target_os = "windows")]
pub fn dictate_once() -> Result<SpeechResult, String> {
    use std::process::Command;

    // Windows System.Speech uses the locally installed recognition engine and default microphone.
    // The script is static; no user input is interpolated into PowerShell.
    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)
$recognizer.SetInputToDefaultAudioDevice()
$recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6)
$recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(3)
$recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(900)
$recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromSeconds(1.5)
$result = $recognizer.Recognize([TimeSpan]::FromSeconds(45))
if ($null -eq $result) {
  Write-Output '{"text":"","confidence":null}'
} else {
  $payload = [PSCustomObject]@{ text = $result.Text; confidence = [double]$result.Confidence }
  $payload | ConvertTo-Json -Compress
}
$recognizer.Dispose()
"#;

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("Could not start Windows local speech recognition: {e}"))?;

    if !output.status.success() {
        return Err("Windows local speech recognition did not complete successfully. Check that a Windows speech language is installed and a microphone is available.".to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(raw.trim())
        .map_err(|_| "Windows speech recognition returned an unreadable result.".to_string())?;

    Ok(SpeechResult {
        text: value.get("text").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        confidence: value.get("confidence").and_then(|v| v.as_f64()).map(|v| v as f32),
        engine: "Windows System.Speech (local)".to_string(),
    })
}

#[cfg(not(target_os = "windows"))]
pub fn dictate_once() -> Result<SpeechResult, String> {
    Err("Local speech capture is currently implemented for the Windows desktop build only.".to_string())
}
