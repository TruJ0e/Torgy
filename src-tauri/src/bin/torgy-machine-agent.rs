fn main() {
    for arg in std::env::args().skip(1) {
        if let Some(encoded) = arg.strip_prefix("--configure-agent=") {
            if let Err(error) = torgy_lib::configure_machine_agent(encoded) {
                eprintln!("Torgy Machine Agent configuration failed: {error}");
                std::process::exit(2);
            }
            return;
        }
    }

    if let Err(error) = torgy_lib::run_machine_agent() {
        eprintln!("Torgy Machine Agent stopped: {error}");
        std::process::exit(1);
    }
}
