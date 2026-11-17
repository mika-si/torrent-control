import {promises} from 'node:fs';
import vm from 'node:vm';
import sinon from 'sinon';
import {getTestTorrent} from './helpers.js';

const source = await promises.readFile('./src/content-script.js', 'utf8');

// Load content-script.js in a fresh context and return its onMessage listener.
// `content` is only defined when the test passes one, like in Firefox.
function loadContentScript(globals) {
    let listener = null;
    vm.runInNewContext(source, {
        chrome: {runtime: {onMessage: {addListener: (fn) => { listener = fn; }}}},
        URL,
        ...globals,
    });
    return listener;
}

async function torrentResponse() {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({'content-disposition': 'attachment; filename="test.torrent"'}),
        blob: async () => getTestTorrent(),
    };
}

describe('Content script', () => {
    it('fetchTorrent uses the page fetch (content.fetch) when available', async () => {
        const pageFetch = sinon.stub().resolves(await torrentResponse());
        const extensionFetch = sinon.stub().rejects(new Error('should not be called'));
        const listener = loadContentScript({content: {fetch: pageFetch}, fetch: extensionFetch});

        const response = await listener({type: 'fetchTorrent', url: 'https://example.com/dl.php?t=1'});

        expect(pageFetch.calledOnceWith('https://example.com/dl.php?t=1')).to.equal(true);
        expect(extensionFetch.called).to.equal(false);
        expect(response.ok).to.equal(true);
        expect(response.filename).to.equal('test.torrent');
        expect(response.content.type).to.equal('application/x-bittorrent');
    });

    it('fetchTorrent falls back to fetch when content.fetch is not available', async () => {
        const extensionFetch = sinon.stub().resolves(await torrentResponse());
        const listener = loadContentScript({fetch: extensionFetch});

        const response = await listener({type: 'fetchTorrent', url: 'https://example.com/test.torrent'});

        expect(extensionFetch.calledOnce).to.equal(true);
        expect(response.ok).to.equal(true);
    });

    it('fetchTorrent sends a plain headers object the page fetch can read', async () => {
        const pageFetch = sinon.stub().resolves(await torrentResponse());
        const listener = loadContentScript({content: {fetch: pageFetch}, fetch: sinon.stub()});

        await listener({type: 'fetchTorrent', url: 'https://example.com/test.torrent'});

        const options = pageFetch.firstCall.args[1];
        expect(Object.getPrototypeOf(options.headers).constructor.name).to.equal('Object');
        expect(options.headers.accept).to.contain('application/x-bittorrent');
    });

    it('ignores other messages', async () => {
        const pageFetch = sinon.stub();
        const listener = loadContentScript({content: {fetch: pageFetch}, fetch: sinon.stub()});

        expect(await listener({type: 'somethingElse'})).to.equal(undefined);
        expect(pageFetch.called).to.equal(false);
    });
});
