# provider-governance

Pi extension enforcing provider/model governance. See `PHASE-0-COMPLETE.md` and
`PHASE-2-COMPLETE.md` for the design and the phase records.

## Running the tests

Install first — the suite needs a real `node_modules`, and the conformance tests spawn a live `pi`:

```sh
npm ci
npm test            # whole suite: 123 tests
npm run conformance # phase-2 conformance only: 24 tests
```

**Use the project's runner (`tsx --test`), not `bun test`.** Both runners execute the same files,
but under `bun test` the phase-2 conformance case "routes an RPC prompt only to the loopback mock"
fails: the spawned `pi` exits in ~360 ms without ever reaching the loopback mock, so the mock
records no `/v1/messages` request. Under `tsx` the same test takes ~670 ms and passes. The failure
is a property of the runner's child-process handling, not of the extension, the provider
registration, or the RPC input shape — all of which are exercised and pass under `tsx`.

The distinction matters because the conformance suite spawns `pi` from `PATH`, not the pinned
dependency. `package.json` pins `@earendil-works/pi-coding-agent` at 0.80.10 while the installed
binary may be newer; the suite therefore validates against whatever Pi is installed. That is
deliberate for now — it catches real drift — but it means a conformance failure can mean either
"the extension broke" or "Pi changed". Reproduce under `npm run conformance` before concluding
either, and do not change the spawn target or raise the pin without a failing run from the
project's own runner.
