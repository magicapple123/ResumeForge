"""Stress-dataset seeding toolkit, split into narrow single-purpose modules.

Package layout (import of every module here is side-effect free: no
directories are created, no engine is built, no file is touched until
``cli.main`` / ``cli.run_seed`` explicitly does so):

- ``counts``   -- scale presets (500 / 2000 / 10000) and per-domain row counts
- ``paths``    -- sandbox path policy (containment, reparse-point escape,
                  existing-target rejection, run-id directory proposal)
- ``context``  -- ``SeedContext``: everything the generators need, passed
                  explicitly instead of relying on module globals
- ``vocab``    -- fictional word pools shared by the generators
- ``blobs``    -- deterministic PNG / PDF / DOCX byte builders
- ``schema``   -- lazy app imports, engine creation, Alembic ``upgrade head``
- ``gen_*``    -- one module per data domain, all functions take ``SeedContext``
- ``pipeline`` -- ordered orchestration of the domain generators
- ``manifest`` -- JSON manifest writing + file hashing
- ``report``   -- markdown import report
- ``apicheck`` -- optional read-only API self-check (imports ``app.main``)
- ``inspect``  -- read-only inspection of an existing stress run directory
- ``cli``      -- argument parsing (first thing that runs) and assembly

Safety contract:

1. Importing any module in this package performs no filesystem writes.
2. ``--help`` and argument errors never touch the filesystem.
3. Seeding only ever writes inside a validated sandbox root, into a run
   directory that did not exist before the run started.
4. The "stress" substring is never used as a security decision.
5. ``--check-only`` opens the target database in SQLite read-only mode and
   never seeds, never drops anything.
"""
