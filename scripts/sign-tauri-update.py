from __future__ import annotations

import argparse
import base64
import time
from pathlib import Path

import minisign


def decode_tauri_key(path: Path) -> bytes:
    encoded = path.read_bytes().strip()
    return base64.b64decode(encoded, validate=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Tauri-compatible updater signature.")
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--private-key", required=True, type=Path)
    parser.add_argument("--public-key", required=True, type=Path)
    parser.add_argument("--password", default="")
    args = parser.parse_args()

    artifact = args.artifact.resolve()
    secret = minisign.SecretKey.from_bytes(decode_tauri_key(args.private_key))
    public = minisign.PublicKey.from_bytes(decode_tauri_key(args.public_key))

    with secret:
        secret.decrypt(args.password)
        signature = secret.sign_file(
            artifact,
            prehash=True,
            untrusted_comment="signature from tauri secret key",
            trusted_comment=f"timestamp:{int(time.time())}\tfile:{artifact.name}",
        )

    public.verify_file(artifact, signature)
    encoded = base64.b64encode(bytes(signature)).decode("ascii")
    signature_path = Path(f"{artifact}.sig")
    signature_path.write_text(encoded, encoding="ascii")

    decoded = minisign.Signature.from_bytes(base64.b64decode(signature_path.read_text("ascii")))
    public.verify_file(artifact, decoded)
    print(f"Verified Tauri updater signature: {signature_path}")


if __name__ == "__main__":
    main()
