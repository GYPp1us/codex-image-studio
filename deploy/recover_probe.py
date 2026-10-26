"""Recover an actual generated probe after an interrupted shell-copy operation."""
import os
import sys
from pathlib import Path

os.environ["STUDIO_DATA"] = "/var/lib/image-studio"
sys.path.insert(0, "/opt/image-studio/current")
import app

probe = app.setting("probe")
job = app.query("SELECT * FROM jobs WHERE id=?", (probe,), True)
if job and job["status"] == "failed":
    image = app.find_generated_image(probe, app.DATA / "jobs" / probe)
    if image:
        result = app.record_generated_image(probe, image)
        print("Recovered actual generated image:", result["id"], result["width"], result["height"])
    else:
        raise SystemExit("No actual image file was found")
else:
    print("No failed probe requires recovery")
