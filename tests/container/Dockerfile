# The image athanor runs grimoire's checks in. Its build context is this folder
# alone, and it installs nothing from npm.
#
# node:24-bookworm-slim, pinned by digest so a moved tag cannot change what runs
# the checks without a reviewed change. Node 24 is the repository's floor. The
# digest is the multi-platform index; to move it, pull the tag, read its new
# digest from `docker buildx imagetools inspect`, and review the diff here.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

# git, because athanor's boot script commits the snapshot only when the image has
# it, and the tests and rule 2b of scripts/check.mjs need a repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

# The image's own non-root user, whose home holds $HOME/work.
USER node
