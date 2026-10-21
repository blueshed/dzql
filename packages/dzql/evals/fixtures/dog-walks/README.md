# dog walks, a model told and closed

The start of `modelling.json`'s scenario 3: a model no example of dzql's builds, so the app is
built from it, not copied. Owners book walks for their dogs and cancel one not yet done; the walker
says a walk is done; each refusal is a `cannot` story. One list document, `rota`, held by both.

Every check is closed (`MODEL_FILE=model.json bunx dzql model check`), and the proof it makes,
`model.test.ts`, passes. The scenario copies this `model.json` over a new app's.
