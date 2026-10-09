fn main() {
    for arg in std::env::args().skip(1) {
        if let Some(encoded) = arg.strip_prefix("--configure-agent=") {
            if let Err(error) = trucalenzer_lib::configure_machine_agent(encoded) {
                eprintln!("TruCalenZer Machine Agent configuration failed: {error}");
                std::process::exit(2);
            }
            return;
        }
    }

    if let Err(error) = trucalenzer_lib::run_machine_agent() {
        eprintln!("TruCalenZer Machine Agent stopped: {error}");
        std::process::exit(1);
    }
}
