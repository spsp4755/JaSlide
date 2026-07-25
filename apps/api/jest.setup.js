// jest's node environment withholds the web globals Node itself provides, so any
// service that builds a multipart body threw "FormData is not defined" — those seven
// suites failed to load, which is why nobody noticed the 25 tests inside them.
//
// Blob is a real Node export. FormData only needs to record what was appended: the
// renderer call is mocked in these suites, and they assert `expect.any(FormData)`.
const { Blob } = require('node:buffer');

class TestFormData {
    #entries = [];
    append(name, value, filename) { this.#entries.push({ name, value, filename }); }
    get(name) { return this.#entries.find((entry) => entry.name === name)?.value ?? null; }
    getAll(name) { return this.#entries.filter((entry) => entry.name === name).map((entry) => entry.value); }
    has(name) { return this.#entries.some((entry) => entry.name === name); }
    *entries() { for (const entry of this.#entries) yield [entry.name, entry.value]; }
    [Symbol.iterator]() { return this.entries(); }
}

globalThis.Blob ??= Blob;
globalThis.FormData ??= TestFormData;
