import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { createApp } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { QUEUE_SCOPE } from '../lib/spotify.mjs';
import { REDEMPTION_EVENT } from '../lib/twitch.mjs';

const spotifyClient = 'a'.repeat(32), twitchClient = 'b'.repeat(30);
const trackId = '3xS7oX7a7Xt6RMllSRctkt';
const spotifyTrack = { id: trackId, name: 'Beyond the Sea', artists: [{ name: 'Bobby Darin' }], is_playable: true };
const rawReward = (id, properties = {}) => ({ id, title: `Song Request ${id}`, cost: 500, is_enabled: true, is_user_input_required: true, ...properties });
const scope = ['channel:manage:redemptions', 'user:write:chat'];
const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

class Socket extends EventTarget {
  constructor(url) { super(); this.url = url; this.closed = false; }
  receive(type, payload) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ metadata: { message_type: type }, payload }) }));
  }
  welcome(id) { this.receive('session_welcome', { session: { id, keepalive_timeout_seconds: 10 } }); }
  redemption(id, input, overrides = {}) {
    this.receive('notification', { subscription: { type: REDEMPTION_EVENT }, event: {
      id, broadcaster_user_id: '42', user_login: 'zuschauer', reward: { id: 'mine' }, status: 'unfulfilled', user_input: input, ...overrides,
    } });
  }
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
}

async function fixture(t, remote = async () => { throw new Error('Unexpected network request'); }) {
  const dir = mkdtempSync(join(tmpdir(), 'island-requests-')), store = createStore(dir), sockets = [];
  const makeApp = data => createApp({ store: data, port: 0, fetchFn: remote, connectWebSocket: url => {
    const socket = new Socket(url); sockets.push(socket); return socket;
  } });
  let app = makeApp(store), origin, csrf;
  async function start() {
    origin = await app.start(); csrf = (await (await fetch(`${origin}/api/state`)).json()).csrf;
  }
  await start();
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, method = 'GET', data, headers = {}) => fetch(origin + path, { method, redirect: 'manual',
    headers: { ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-Island-CSRF': csrf }), ...headers },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const profile = () => app.store.state.profiles[0];
  const path = `/api/profiles/${profile().id}`, requests = `${path}/song-requests`;
  return { get app() { return app; }, get p() { return profile(); }, get origin() { return origin; }, call, path, requests, sockets, dir,
    state: async () => (await call(requests)).json(),
    drain: async () => { await app.songRequests.jobs.get(profile().id)?.tail; },
    async restart() { await app.close(); app = makeApp(createStore(dir)); await start(); await tick(); },
  };
}

function connectSpotify(p, write = true) {
  Object.assign(p, { clientId: spotifyClient, accessToken: 'SPOTIFY-ACCESS', refreshToken: 'SPOTIFY-REFRESH', expiresAt: Date.now() + 3600000,
    spotifyScopes: ['user-read-currently-playing', ...(write ? [QUEUE_SCOPE] : [])] });
}
function connectTwitch(p) {
  p.twitchClientId = twitchClient;
  p.twitch = { clientId: twitchClient, userId: '42', login: 'kanal', accessToken: 'TWITCH-ACCESS', refreshToken: 'TWITCH-REFRESH', expiresAt: Date.now() + 3600000 };
}

test('Spotify write permission is opt-in and existing read-only OAuth keeps working', async t => {
  let granted = 'user-read-currently-playing';
  const f = await fixture(t, async url => {
    assert.equal(url, 'https://accounts.spotify.com/api/token');
    return json({ access_token: 'NEW-SPOTIFY-ACCESS', refresh_token: 'NEW-SPOTIFY-REFRESH', expires_in: 3600, scope: granted });
  });
  connectSpotify(f.p, false);
  assert.equal((await f.state()).spotifyReady, false);
  const authorize = async () => {
    const start = await f.call(`${f.path}/connect`, 'POST', { purpose: 'song-requests' });
    const auth = new URL((await start.json()).url);
    assert.equal(auth.searchParams.get('scope'), `user-read-currently-playing ${QUEUE_SCOPE}`);
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    return f.call(`/auth/callback?state=${auth.searchParams.get('state')}&code=spotify-code`, 'GET', undefined, { Cookie: start.headers.get('set-cookie').split(';')[0] });
  };
  const denied = await authorize();
  assert.equal(denied.headers.get('location'), '/?error=oauth_scope');
  assert.equal(f.p.accessToken, 'SPOTIFY-ACCESS');
  granted += ` ${QUEUE_SCOPE}`;
  const approved = await authorize();
  assert.equal(approved.headers.get('location'), `/?connected=${f.p.id}#song-requests`);
  assert.equal((await f.state()).spotifyReady, true);
  assert.equal((await f.state()).enabled, false);
});

test('Twitch device login keeps credentials private and rotates one-use refresh tokens once', async t => {
  let exchange = 0, refresh = 0, lookup = 0;
  const f = await fixture(t, async (url, options) => {
    const target = new URL(url);
    if (target.pathname === '/oauth2/device') {
      assert.equal(options.body.get('client_id'), twitchClient);
      assert.deepEqual(options.body.get('scopes').split(' '), scope);
      return json({ device_code: 'DEVICE-SECRET', user_code: 'ABCD-1234', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD-1234', expires_in: 1800, interval: 5 });
    }
    if (target.pathname === '/oauth2/token') {
      assert.equal(options.body.has('client_secret'), false);
      if (options.body.get('grant_type') === 'refresh_token') {
        refresh++; assert.equal(options.body.get('refresh_token'), 'TWITCH-REFRESH%=&');
        return json({ access_token: 'TWITCH-ROTATED', refresh_token: 'REFRESH-ROTATED', expires_in: 14400, scope });
      }
      exchange++; assert.equal(options.body.get('device_code'), 'DEVICE-SECRET');
      return exchange === 1 ? json({ message: 'authorization_pending' }, 400)
        : json({ access_token: 'TWITCH-ACCESS', refresh_token: 'TWITCH-REFRESH%=&', expires_in: 14400 });
    }
    if (target.pathname === '/oauth2/validate') {
      assert.equal(options.headers.Authorization, 'OAuth TWITCH-ACCESS');
      return json({ client_id: twitchClient, user_id: '42', login: 'kanal', scopes: scope });
    }
    if (target.pathname === '/helix/channel_points/custom_rewards') {
      lookup++; assert.equal(options.headers.Authorization, 'Bearer TWITCH-ROTATED'); return json({ data: [] });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  const blocked = await f.call(`${f.requests}/twitch-connect`, 'POST', { clientId: twitchClient }, { Origin: 'https://untrusted.example' });
  assert.equal(blocked.status, 403);
  const start = await f.call(`${f.requests}/twitch-connect`, 'POST', { clientId: twitchClient });
  assert.equal(start.status, 200);
  const body = await start.text(); assert.match(body, /ABCD-1234/); assert.doesNotMatch(body, /DEVICE-SECRET/);
  const pairing = f.app.songRequests.twitch.pairs.get(f.p.id);
  await f.app.songRequests.twitch.pollPair(f.p, pairing);
  assert.equal((await f.state()).twitchConnected, false);
  await f.app.songRequests.twitch.pollPair(f.p, pairing);
  assert.equal((await f.state()).twitchLogin, 'kanal'); assert.equal((await f.state()).pairing, null);
  assert.equal(f.sockets.length, 0);
  for (const path of [f.requests, '/api/state', `/api/overlay/${f.p.overlayKey}`])
    assert.doesNotMatch(await (await f.call(path)).text(), /TWITCH-(ACCESS|REFRESH)|DEVICE-SECRET/);
  assert.equal(readFileSync(join(f.dir, 'state.enc')).includes(Buffer.from('TWITCH-REFRESH')), false);
  assert.equal(createStore(f.dir).state.profiles[0].twitch.userId, '42');
  f.p.twitch.expiresAt = 0;
  const rewards = await f.call(`${f.requests}/rewards`);
  assert.equal(rewards.status, 200); assert.equal(lookup, 2); assert.equal(refresh, 1);
  assert.equal(createStore(f.dir).state.profiles[0].twitch.refreshToken, 'REFRESH-ROTATED');
  await f.call(`${f.requests}/twitch-disconnect`, 'POST', {});
  assert.equal((await f.state()).twitchConnected, false);
  assert.equal(createStore(f.dir).state.profiles[0].twitch, undefined);
});

function providers() {
  const calls = { queued: [], chat: [], settled: [], subscriptions: [], searches: [], trackReads: [], created: [] };
  const options = { queueStatus: 204, deliverChat: true };
  const custom = [rawReward('mine'), rawReward('other'), rawReward('no-input', { is_user_input_required: false }), rawReward('disabled', { is_enabled: false })];
  async function fetchFn(url, init) {
    const path = new URL(url), payload = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (path.pathname === '/oauth2/validate') return json({ client_id: twitchClient, user_id: '42', login: 'kanal', scopes: scope });
    if (path.pathname === '/helix/channel_points/custom_rewards') {
      assert.equal(path.searchParams.get('broadcaster_id'), '42');
      if (init.method === 'POST') {
        calls.created.push(payload); const reward = rawReward('created', payload); custom.push(reward); return json({ data: [reward] });
      }
      return json({ data: path.searchParams.get('only_manageable_rewards') === 'true' ? custom.filter(r => ['mine', 'created'].includes(r.id)) : custom });
    }
    if (path.pathname === '/helix/eventsub/subscriptions') {
      calls.subscriptions.push(payload); return json({ data: [{ status: 'enabled' }] }, 202);
    }
    if (path.pathname === '/helix/chat/messages') {
      assert.ok(calls.queued.length > calls.chat.length, 'Chat follows queue acknowledgment');
      calls.chat.push(payload); return json({ data: [{ is_sent: options.deliverChat }] });
    }
    if (path.pathname === '/helix/channel_points/custom_rewards/redemptions') {
      calls.settled.push({ id: path.searchParams.get('id'), status: payload.status }); return json({ data: [{ status: payload.status }] });
    }
    if (path.pathname.startsWith('/v1/tracks/')) { calls.trackReads.push(path.pathname); return json(spotifyTrack); }
    if (path.pathname === '/v1/search') {
      const q = path.searchParams.get('q');
      calls.searches.push(q);
      assert.equal(path.searchParams.get('type'), 'track'); assert.equal(path.searchParams.get('limit'), '10');
      const items = typeof options.searchItems === 'function' ? options.searchItems(q) : options.searchItems;
      return json({ tracks: { items: items || [{ ...spotifyTrack, id: 'x'.repeat(22), artists: [{ name: 'Cover Artist' }] }, spotifyTrack] } });
    }
    if (path.pathname === '/v1/me/player/queue') {
      assert.equal(init.method, 'POST'); calls.queued.push(path.searchParams.get('uri')); return json({}, options.queueStatus);
    }
    throw new Error(`Unexpected request ${url}`);
  }
  return { calls, options, fetchFn };
}

async function enable(f, reward = 'mine', template = 'Danke @{user}: {titel} – {interpret}') {
  const res = await f.call(f.requests, 'PATCH', { enabled: true, rewardId: reward, template });
  assert.equal(res.status, 200, await res.text());
  const socket = f.sockets.at(-1); socket.welcome(`session-${f.sockets.length}`); await tick(); return socket;
}

test('Select or create a reward, queue Spotify URLs and title/artist, confirm and deduplicate across restart', async t => {
  const { calls, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p, false); connectTwitch(f.p);
  assert.equal((await f.state()).enabled, false);
  assert.equal((await f.call(f.requests, 'PATCH', { enabled: true, rewardId: 'mine' })).status, 400);
  assert.equal(f.sockets.length, 0);
  connectSpotify(f.p);
  const list = await (await f.call(`${f.requests}/rewards`)).json();
  assert.equal(list.find(r => r.id === 'other').manageable, false);
  assert.equal(list.find(r => r.id === 'no-input').acceptsInput, false);
  assert.equal((await f.call(f.requests, 'PATCH', { enabled: true, rewardId: 'no-input' })).status, 400);
  assert.equal((await f.call(`${f.requests}/rewards`, 'POST', { title: 'Invalid', cost: -1 })).status, 400);
  const create = await f.call(`${f.requests}/rewards`, 'POST', { title: 'Wunschlied', cost: 750 });
  assert.equal(create.status, 201); assert.equal((await create.json()).id, 'created');
  assert.equal(calls.created[0].is_user_input_required, true);
  assert.equal(calls.created[0].should_redemptions_skip_request_queue, false);
  assert.equal((await f.state()).enabled, false);
  const socket = await enable(f);
  assert.equal((await f.state()).status, 'listening');
  assert.deepEqual(calls.subscriptions[0].condition, { broadcaster_user_id: '42', reward_id: 'mine' });
  socket.redemption('wrong-reward', 'Beyond the Sea - Bobby Darin', { reward: { id: 'other' } });
  socket.redemption('wrong-channel', 'Beyond the Sea - Bobby Darin', { broadcaster_user_id: '17' });
  socket.redemption('first', `https://open.spotify.com/intl-de/track/${trackId}?si=demo`);
  socket.redemption('first', `spotify:track:${trackId}`);
  socket.redemption('second', 'Béyond the Sea – Bobby Darin');
  await f.drain();
  assert.equal(calls.trackReads.length, 1); assert.equal(calls.searches.length, 1);
  assert.deepEqual(calls.queued, Array(2).fill(`spotify:track:${trackId}`));
  assert.deepEqual(calls.chat[0], { broadcaster_id: '42', sender_id: '42', message: 'Danke @zuschauer: Beyond the Sea – Bobby Darin' });
  assert.deepEqual(calls.settled, [{ id: 'first', status: 'FULFILLED' }, { id: 'second', status: 'FULFILLED' }]);
  assert.deepEqual((await f.state()).recent.map(r => r.status), ['queued', 'queued']);
  await f.restart();
  const resumed = f.sockets.at(-1); assert.notEqual(resumed, socket); resumed.welcome('restart'); await tick();
  resumed.redemption('first', `spotify:track:${trackId}`); await f.drain(); assert.equal(calls.queued.length, 2);
  await f.call(f.requests, 'PATCH', { enabled: false });
  assert.equal(resumed.closed, true); resumed.redemption('ignored', `spotify:track:${trackId}`);
  assert.equal(calls.queued.length, 2); assert.equal((await f.state()).status, 'off');
});

test('Chat template can be saved without changing the reward while Spotify needs reconnecting', async t => {
  const { calls, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p); connectTwitch(f.p);
  await enable(f);
  connectSpotify(f.p, false);
  const template = 'Wunsch von {user}: {titel}';
  assert.equal((await f.call(f.requests, 'PATCH', { template: '  ' })).status, 400);
  const save = await f.call(f.requests, 'PATCH', { template });
  assert.equal(save.status, 200);
  const state = await save.json();
  assert.equal(state.template, template);
  assert.equal(state.enabled, true);
  assert.equal(state.status, 'spotify_required');
  assert.equal(state.reward.id, 'mine');
  assert.equal(createStore(f.dir).state.profiles[0].songRequests.template, template);
  assert.equal(calls.subscriptions.length, 1);
});

test('Rejected, uncertain and chat-dropped song requests are reported without double queueing or false success', async t => {
  const { calls, options, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p); connectTwitch(f.p);
  const socket = await enable(f);
  socket.redemption('bad-link', `https://evil.example/track/${trackId}`);
  await f.drain();
  assert.equal(calls.trackReads.length, 0); assert.equal(calls.chat.length, 0);
  assert.deepEqual(calls.settled, [{ id: 'bad-link', status: 'CANCELED' }]);
  options.queueStatus = 404;
  socket.redemption('inactive', `spotify:track:${trackId}`); await f.drain();
  assert.match((await f.state()).recent[0].note, /Kein aktives Spotify-Gerät/);
  assert.deepEqual(calls.settled.at(-1), { id: 'inactive', status: 'CANCELED' });
  options.queueStatus = 502;
  socket.redemption('uncertain', `spotify:track:${trackId}`); await f.drain();
  assert.equal((await f.state()).recent[0].status, 'unknown');
  assert.equal(calls.settled.length, 2); assert.equal(calls.chat.length, 0);
  socket.redemption('uncertain', `spotify:track:${trackId}`); await f.drain();
  assert.equal(calls.queued.length, 2);
  options.queueStatus = 204; options.deliverChat = false;
  socket.redemption('chat-dropped', `spotify:track:${trackId}`); await f.drain();
  const queued = (await f.state()).recent[0]; assert.equal(queued.status, 'queued'); assert.match(queued.note, /Chatbestätigung fehlgeschlagen/);
  const other = await enable(f, 'other');
  other.redemption('external', `spotify:track:${trackId}`, { reward: { id: 'other' } }); await f.drain();
  assert.equal(calls.settled.length, 3, 'Do not manage a reward created by a different app');
});

test('Free-text requests find the exact title and artist in either order without queueing unrelated results', async t => {
  const { calls, options, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p); connectTwitch(f.p);
  const socket = await enable(f);
  const levels = { id: 'a'.repeat(22), name: 'Levels', artists: [{ name: 'Avicii' }], is_playable: true };
  options.searchItems = [
    { ...levels, id: 'b'.repeat(22), is_playable: false },
    { ...levels, id: 'c'.repeat(22), artists: [{ name: 'Cover Artist' }] },
    { ...levels, id: 'd'.repeat(22), name: 'Levels - Radio Edit' },
    levels,
  ];
  socket.redemption('artist-first', '  Avicii  Levels  ');
  socket.redemption('title-first', 'Levels Avicii');
  socket.redemption('no-matching-title', 'Avicii Ein anderer Titel');
  await f.drain();
  assert.deepEqual(calls.searches, ['Avicii Levels', 'Levels Avicii', 'Avicii Ein anderer Titel', 'track:Avicii Ein anderer Titel']);
  assert.deepEqual(calls.queued, Array(2).fill(`spotify:track:${levels.id}`));
  assert.deepEqual(calls.chat.map(entry => entry.message), Array(2).fill('Danke @zuschauer: Levels – Avicii'));
  assert.deepEqual((await f.state()).recent.map(entry => entry.status), ['rejected', 'queued', 'queued']);
  assert.deepEqual(calls.settled.at(-1), { id: 'no-matching-title', status: 'CANCELED' });
});

test('Title-only requests favor matching playable songs and confirm a successful HTTP 200', async t => {
  const { calls, options, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p); connectTwitch(f.p);
  const socket = await enable(f);
  const radio = { ...spotifyTrack, id: 'a'.repeat(22), name: 'Levels - Radio Edit', artists: [{ name: 'Avicii' }], popularity: 92 };
  options.searchItems = [
    { ...radio, id: 'b'.repeat(22), name: 'A Different Song', popularity: 100 },
    { ...radio, id: 'c'.repeat(22), name: 'Levels', artists: [{ name: 'Cover Artist' }], popularity: 12 },
    { ...radio, id: 'd'.repeat(22), name: 'Levels', is_playable: false, popularity: 100 },
    { ...radio, id: 'e'.repeat(22), name: 'Levels - Festival Remix', popularity: 98 },
    radio,
  ];
  options.queueStatus = 200;
  socket.redemption('title-only', 'Levels');
  await f.drain();
  assert.deepEqual(calls.searches, ['Levels']);
  assert.deepEqual(calls.queued, [`spotify:track:${radio.id}`]);
  assert.equal(calls.chat[0].message, 'Danke @zuschauer: Levels - Radio Edit – Avicii');
  assert.deepEqual(calls.settled, [{ id: 'title-only', status: 'FULFILLED' }]);
  const entry = (await f.state()).recent[0];
  assert.equal(entry.status, 'queued'); assert.equal(entry.note, '');
});

test('Title search retries with the track filter and preserves Spotify order without popularity', async t => {
  const { calls, options, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p); connectTwitch(f.p);
  const socket = await enable(f);
  const preferred = { ...spotifyTrack, id: 'p'.repeat(22), name: 'One' };
  options.searchItems = q => q === 'track:One' ? [preferred, { ...preferred, id: 'q'.repeat(22), artists: [{ name: 'Another Band' }] }] : [spotifyTrack];
  socket.redemption('title-filter', 'One');
  await f.drain();
  assert.deepEqual(calls.searches, ['One', 'track:One']);
  assert.deepEqual(calls.queued, [`spotify:track:${preferred.id}`]);
  assert.equal((await f.state()).recent[0].status, 'queued');
});

test('A dash inside the requested title does not require a matching artist name', async t => {
  const { calls, options, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p); connectTwitch(f.p);
  const socket = await enable(f);
  const radio = { ...spotifyTrack, id: 'r'.repeat(22), name: 'Levels - Radio Edit', artists: [{ name: 'Avicii' }], popularity: 63 };
  options.searchItems = q => q.startsWith('track:') ? [] : [{ ...radio, id: 's'.repeat(22), name: 'Levels', popularity: 91 }, radio];
  socket.redemption('version-title', 'Levels - Radio Edit');
  await f.drain();
  assert.deepEqual(calls.searches, ['track:Levels artist:Radio Edit', 'Levels - Radio Edit']);
  assert.deepEqual(calls.queued, [`spotify:track:${radio.id}`]);
});

test('An incomplete title ranks a closer match ahead of a more popular version', async t => {
  const { calls, options, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p); connectTwitch(f.p);
  const socket = await enable(f);
  const closest = { ...spotifyTrack, id: 'z'.repeat(22), name: 'Bohemian Rhapsody', artists: [{ name: 'Queen' }], popularity: 58 };
  options.searchItems = [{ ...closest, id: 'y'.repeat(22), name: 'Bohemian Rhapsody - Live', popularity: 99 }, closest];
  socket.redemption('partial-title', 'Bohemian Rhapsod');
  await f.drain();
  assert.deepEqual(calls.queued, [`spotify:track:${closest.id}`]);
  assert.equal((await f.state()).recent[0].status, 'queued');
});

test('EventSub migrates without resubscribing and stops when Twitch revokes authorization', async t => {
  const { calls, fetchFn } = providers(), f = await fixture(t, fetchFn);
  connectSpotify(f.p); connectTwitch(f.p);
  const socket = await enable(f);
  socket.receive('session_reconnect', { session: { reconnect_url: 'wss://example.test/ws' } });
  assert.equal(f.sockets.length, 1);
  socket.receive('session_reconnect', { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?session=next' } });
  const next = f.sockets.at(-1);
  assert.notEqual(next, socket); assert.equal(socket.closed, false);
  next.welcome('next'); await tick(); assert.equal(socket.closed, true); assert.equal(calls.subscriptions.length, 1);
  next.redemption('migrated', `spotify:track:${trackId}`); await f.drain(); assert.equal(calls.queued.length, 1);
  next.receive('revocation', { subscription: { type: REDEMPTION_EVENT, status: 'authorization_revoked' } });
  assert.equal(next.closed, true); assert.equal((await f.state()).enabled, false); assert.equal((await f.state()).twitchConnected, false);
});

test('Turning requests off during song lookup stops an outgoing queue mutation', async t => {
  const { calls, fetchFn } = providers();
  let reachedLookup, releaseLookup;
  const lookupStarted = new Promise(resolve => reachedLookup = resolve);
  const lookupReply = new Promise(resolve => releaseLookup = resolve);
  const f = await fixture(t, (url, init) => {
    if (new URL(url).pathname === `/v1/tracks/${trackId}`) { reachedLookup(); return lookupReply; }
    return fetchFn(url, init);
  });
  connectSpotify(f.p); connectTwitch(f.p);
  const socket = await enable(f);
  socket.redemption('in-flight', `spotify:track:${trackId}`);
  await lookupStarted;
  assert.equal((await f.call(f.requests, 'PATCH', { enabled: false })).status, 200);
  releaseLookup(json(spotifyTrack)); await f.drain();
  assert.equal(socket.closed, true);
  assert.equal(calls.queued.length, 0); assert.equal(calls.chat.length, 0); assert.equal(calls.settled.length, 0);
  assert.match((await f.state()).recent[0].note, /ausgeschaltet/);
});
