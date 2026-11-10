"""Process lifetime exclusive lock for serial MLX media/vision services."""
import fcntl
import os
from pathlib import Path


def acquire_model_lock():
    path = Path.home() / '.config/learning-hub/model-runtime.lock'
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise SystemExit('Another local media/vision service is running; stop it before loading another model.') from None
    return fd  # retain until process exit
