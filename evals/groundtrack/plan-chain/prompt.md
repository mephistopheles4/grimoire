---
max_turns: 40
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/groundtrack

Here is a plan already agreed: map #40, five tickets to move user avatars from the app server's disk to object storage. Draw the graph for the whole map (one entry point, the map), with one run where the plan goes through and one where it stops, validate it, and render the page. The working folder is your scratch folder: write the file as `trace/avatars.flightpath.json`, the page as `trace/avatars.html`, and save what `--text` prints for the run where the plan stops to `trace/tree.txt`.

## #40 Map: avatars move to object storage

Avatars live under `/var/app/avatars` on one server, 180,000 files. The disk is nearly full. The tickets:

- **#41 Bucket.** Create the bucket and its write credentials. Needs the infra team's approval. Leaves: the bucket and its config entry.
- **#42 Dual write.** New uploads are written to the disk and to the bucket. Blocked by #41. Leaves: a merged PR.
- **#43 Backfill.** A script copies every existing avatar to the bucket. Blocked by #41. A file it cannot read is logged and skipped, and the run carries on. If the bucket's quota is exceeded the script stops, and the plan stops with it until someone raises the quota. Leaves: a report listing every skipped file.
- **#44 Read switch.** Reads come from the bucket behind a flag. Blocked by #42 and #43. Refuses to start while the backfill report lists any skipped file; that sends the work back to #43 to copy those files by hand. Leaves: the flag, on.
- **#45 Disk cleanup.** Stop writing to disk and delete the old files. Blocked by #44, and must not start until the flag has been on for seven days. Deleting the files cannot be undone. Leaves: the freed disk.
