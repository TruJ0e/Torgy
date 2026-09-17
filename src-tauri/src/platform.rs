use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub app_mode: &'static str,
    pub supports_coordinator: bool,
    pub supports_student: bool,
    pub supports_managed_agent: bool,
    pub supports_portable_sync: bool,
    pub portable_sync_configured: bool,
    pub secure_storage: bool,
}

pub fn capabilities() -> Capabilities {
    #[cfg(target_os = "windows")]
    {
        return Capabilities {
            app_mode: "advisor",
            supports_coordinator: true,
            supports_student: true,
            supports_managed_agent: true,
            supports_portable_sync: false,
            portable_sync_configured: false,
            secure_storage: true,
        };
    }
    #[cfg(target_vendor = "apple")]
    {
        return Capabilities {
            app_mode: "student",
            supports_coordinator: false,
            supports_student: true,
            supports_managed_agent: false,
            supports_portable_sync: true,
            portable_sync_configured: false,
            secure_storage: true,
        };
    }
    #[cfg(all(not(target_os = "windows"), not(target_vendor = "apple")))]
    {
        Capabilities {
            app_mode: "development",
            supports_coordinator: false,
            supports_student: true,
            supports_managed_agent: false,
            supports_portable_sync: false,
            portable_sync_configured: false,
            secure_storage: cfg!(debug_assertions),
        }
    }
}
pub fn require_coordinator() -> Result<(), String> {
    if capabilities().supports_coordinator {
        Ok(())
    } else {
        Err("Coordinator capabilities are not available in this Torgy student build.".into())
    }
}

pub fn require_managed_agent() -> Result<(), String> {
    if capabilities().supports_managed_agent {
        Ok(())
    } else {
        Err("The Windows managed sync agent is not available on this platform.".into())
    }
}
