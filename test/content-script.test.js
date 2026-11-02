import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import sinon from 'sinon';

const source = await readFile(new URL('../src/content-script.js', import.meta.url), 'utf8');

describe('Content script', () => {
    let context;
    let response;
    let blob;
    const request = {
        type: 'fetchTorrent',
        url: 'https://example.com/test.torrent',
    };

    beforeEach(() => {
        blob = new Blob(['torrent']);
        response = {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({'content-disposition': 'attachment; filename="download.torrent"'}),
            blob: sinon.stub().resolves(blob),
        };
        context = {
            chrome,
            Headers,
            URL,
            fetch: sinon.stub().resolves(response),
        };
    });

    function loadListener() {
        runInNewContext(source, context);
        expect(chrome.runtime.onMessage.addListener.calledOnce).to.equal(true);
        return chrome.runtime.onMessage.addListener.firstCall.args[0];
    }

    function expectRequest(fetch) {
        expect(fetch.calledOnce).to.equal(true);
        const [url, options] = fetch.firstCall.args;
        expect(url).to.equal(request.url);
        expect(options.headers).to.deep.equal({
            accept: 'application/x-bittorrent,application/octet-stream,*/*',
        });
    }

    it('prefers content.fetch and preserves its receiver', async () => {
        context.content = {fetch: sinon.stub().resolves(response)};

        const result = await loadListener()(request);

        expectRequest(context.content.fetch);
        expect(context.content.fetch.calledOn(context.content)).to.equal(true);
        expect(context.fetch.called).to.equal(false);
        expect(result).to.deep.equal({
            ok: true,
            status: 200,
            statusText: 'OK',
            filename: 'download.torrent',
            content: blob,
        });
    });

    for (const [description, properties] of [
        ['content is absent', {}],
        ['content is undefined', {content: undefined}],
        ['content.fetch is absent', {content: {}}],
        ['content.fetch is not callable', {content: {fetch: true}}],
    ]) {
        it(`falls back to global fetch when ${description}`, async () => {
            Object.assign(context, properties);
            response.headers = new Headers();

            const result = await loadListener()(request);

            expectRequest(context.fetch);
            expect(result).to.deep.equal({
                ok: true,
                status: 200,
                statusText: 'OK',
                filename: 'test.torrent',
                content: blob,
            });
        });
    }

    for (const useContent of [true, false]) {
        it(`returns network errors from ${useContent ? 'content.fetch' : 'global fetch'}`, async () => {
            const error = new Error('Network error');
            if (useContent) {
                context.content = {fetch: sinon.stub().rejects(error)};
            } else {
                context.fetch.rejects(error);
            }

            const result = await loadListener()(request);

            expect(result).to.equal(error);
            if (useContent) {
                expect(context.fetch.called).to.equal(false);
            }
        });
    }

    it('preserves unsuccessful HTTP responses from global fetch', async () => {
        Object.assign(response, {ok: false, status: 404, statusText: 'Not Found'});

        const result = await loadListener()(request);

        expectRequest(context.fetch);
        expect(result).to.deep.equal({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            filename: 'download.torrent',
            content: blob,
        });
    });

    it('ignores unrelated messages', async () => {
        context.content = {fetch: sinon.stub()};

        const result = await loadListener()({type: 'unrelated'});

        expect(result).to.equal(undefined);
        expect(context.content.fetch.called).to.equal(false);
        expect(context.fetch.called).to.equal(false);
    });
});
