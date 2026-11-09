const $ = id => document.getElementById(id);
const time = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' });
const statusNames = { off: 'Aus', connecting: 'Verbindet', listening: 'Bereit', reconnecting: 'Verbindet erneut',
  error: 'Fehler', twitch_required: 'Twitch fehlt', spotify_required: 'Spotify fehlt', reward_required: 'Reward fehlt' };
const historyNames = { queued: 'Eingereiht', processing: 'Wird verarbeitet', rejected: 'Abgelehnt', unknown: 'Bitte prüfen' };
const demo = { titel: 'Night Drive', interpret: 'Island Demo', user: 'zuschauer' };

export function bindSongRequests({ api, connectSpotify }) {
  let id, revision = 0, state, rewards, busy = false, offline = false, pollId, historyKey;
  const endpoint = () => `/api/profiles/${id}/song-requests`;
  function notice(text, error = false) {
    const el = $('requests-notice'); el.textContent = text; el.hidden = !text; el.classList.toggle('error', error);
  }
  function fillRewards(selected = $('requests-reward').value) {
    const select = $('requests-reward');
    const options = (rewards || []).map(r => {
      const opt = new Option(`${r.title} · ${r.cost} Punkte${!r.acceptsInput ? ' · ohne Texteingabe' : !r.enabled ? ' · deaktiviert' : r.paused ? ' · pausiert' : ''}`, r.id);
      opt.disabled = !r.enabled || !r.acceptsInput; return opt;
    });
    if (state?.reward && !options.some(o => o.value === state.reward.id)) {
      const saved = new Option(`${state.reward.title} · ${rewards ? 'nicht verfügbar' : 'gespeichert'}`, state.reward.id);
      saved.disabled = true; options.push(saved);
    }
    select.replaceChildren(new Option('Reward auswählen', ''), ...options);
    select.value = options.some(o => o.value === selected) ? selected : '';
  }
  function preview() {
    $('requests-chat-preview').textContent = $('requests-template').value.replace(/\{(titel|interpret|user)\}/g, (_, key) => demo[key]);
  }
  function controls() {
    const option = $('requests-reward').selectedOptions[0];
    const valid = !!option?.value && !option.disabled;
    const locked = !state || busy || offline;
    $('requests-enabled').disabled = locked || !state.enabled && !(state.spotifyReady && state.twitchConnected && valid);
    $('requests-spotify').disabled = locked;
    $('requests-connect').disabled = locked || !!state.pairing?.code;
    for (const id of ['requests-disconnect', 'requests-cancel-pairing', 'requests-refresh-rewards', 'requests-create', 'requests-save']) $(id).disabled = locked;
    const reward = rewards?.find(r => r.id === option?.value);
    $('requests-reward-hint').textContent = reward ? reward.manageable ? 'Bei Erfolg wird die Einlösung bestätigt. Bei eindeutiger Ablehnung gibt Twitch die Punkte zurück.'
      : 'Island Now kann diesen Reward verwenden. Bestätigung oder Rückerstattung der Punkte erfolgt im Twitch-Dashboard.'
      : 'Nur aktive Rewards mit erforderlicher Texteingabe können als Trigger dienen.';
  }
  function render(data, applyInputs = false) {
    state = data; offline = false;
    const badge = $('requests-badge');
    badge.textContent = statusNames[data.status] || 'Aus'; badge.dataset.state = data.status;
    $('requests-enabled').checked = data.enabled;
    const status = data.detail || (data.status === 'listening' ? `Wartet auf „${data.reward?.title}“ im Kanal @${data.twitchLogin}.`
      : data.status === 'connecting' ? 'Twitch-Trigger wird verbunden …'
      : !data.spotifyReady ? 'Spotify-Warteschlange freigeben, um Songs einzureihen.'
      : !data.twitchConnected ? 'Twitch verbinden, um Kanalpunkte einzulesen.'
      : data.enabled ? 'Reward und Verbindungen prüfen.' : 'Wähle einen Reward und schalte Song Requests ein.');
    if ($('requests-status').textContent !== status) $('requests-status').textContent = status;
    $('requests-spotify-state').textContent = data.spotifyReady ? 'Warteschlange freigegeben' : 'Warteschlange noch nicht freigegeben';
    $('requests-spotify').hidden = data.spotifyReady;
    $('requests-twitch-state').textContent = data.twitchConnected ? `Verbunden als @${data.twitchLogin}` : data.pairing?.error || 'Nicht verbunden';
    $('requests-disconnect').hidden = !data.twitchConnected;
    $('requests-twitch-form').hidden = data.twitchConnected || !!data.pairing?.code;
    $('requests-client-id').placeholder = data.hasTwitchClientId ? 'Gespeicherte Client-ID verwenden' : 'Client-ID deiner Twitch-App';
    $('requests-pairing').hidden = !data.pairing?.code;
    $('requests-code').textContent = data.pairing?.code || '';
    if (data.pairing?.url) $('requests-activate').href = data.pairing.url; else $('requests-activate').removeAttribute('href');
    $('requests-config').hidden = !data.twitchConnected;
    if (!data.twitchConnected) rewards = undefined;
    if (applyInputs) { $('requests-template').value = data.template; fillRewards(data.reward?.id || ''); preview(); }
    const key = JSON.stringify(data.recent);
    if (key !== historyKey) {
      historyKey = key;
      $('requests-recent').hidden = !data.recent.length;
      $('requests-history').replaceChildren(...data.recent.map(item => {
        const li = document.createElement('li'), label = document.createElement('strong'), meta = document.createElement('span');
        label.textContent = item.title ? `${item.title} – ${item.artist}` : 'Songwunsch';
        meta.textContent = `${time.format(item.at)} · @${item.user} · ${historyNames[item.status] || item.status}${item.note ? ` · ${item.note}` : ''}`;
        li.append(label, meta); li.dataset.state = item.status; return li;
      }));
    }
    controls();
  }
  async function action(task) {
    if (busy || offline || !id) return;
    const current = ++revision, path = endpoint(), profileId = id, live = () => current === revision;
    busy = true; notice(''); controls();
    try { await task(path, live, profileId); }
    catch (error) { if (live()) { notice(error.message, true); $('requests-enabled').checked = !!state?.enabled; } }
    finally { if (live()) { busy = false; controls(); } }
  }
  function loadRewards(fresh = false) {
    return action(async (path, live) => {
      const list = await (fresh ? api(`${path}/refresh-rewards`, 'POST', {}) : api(`${path}/rewards`));
      if (!live()) return;
      rewards = list; fillRewards($('requests-reward').value || state.reward?.id || '');
      if (!list.length) notice('Der Kanal hat noch keine benutzerdefinierten Rewards.');
    });
  }
  async function poll() {
    if (!id || busy || pollId === revision || document.hidden) return;
    const current = revision; pollId = current;
    try {
      const data = await api(endpoint());
      if (current !== revision || busy) return;
      const first = !state, connected = !!state?.twitchConnected;
      render(data, first || connected !== data.twitchConnected);
      if (data.twitchConnected && !connected) loadRewards();
    } catch (error) {
      if (current === revision) {
        offline = true; $('requests-badge').textContent = 'Offline'; $('requests-badge').dataset.state = 'error';
        $('requests-status').textContent = 'Die lokale Anwendung antwortet nicht.'; controls();
      }
    }
    finally { if (pollId === current) pollId = null; }
  }
  const settings = () => ({ rewardId: $('requests-reward').value, template: $('requests-template').value });
  $('requests-spotify').onclick = () => action((_, __, profileId) => connectSpotify(profileId));
  $('requests-twitch-form').onsubmit = event => {
    event.preventDefault();
    action(async (path, live) => {
      const data = await api(`${path}/twitch-connect`, 'POST', { clientId: $('requests-client-id').value.trim() });
      if (live()) { $('requests-client-id').value = ''; render(data); $('requests-activate').focus(); }
    });
  };
  $('requests-cancel-pairing').onclick = () => action(async (path, live) => {
    const data = await api(`${path}/twitch-cancel`, 'POST', {}); if (live()) render(data);
  });
  $('requests-disconnect').onclick = () => action(async (path, live) => {
    const data = await api(`${path}/twitch-disconnect`, 'POST', {}); if (live()) render(data, true);
  });
  $('requests-reward').onchange = controls;
  $('requests-refresh-rewards').onclick = () => loadRewards(true);
  $('requests-template').oninput = preview;
  $('requests-enabled').onchange = event => {
    const enabled = event.target.checked;
    action(async (path, live) => {
      const data = await api(path, 'PATCH', enabled ? { ...settings(), enabled } : { enabled });
      if (live()) { render(data, enabled); notice(enabled ? 'Song Requests eingeschaltet.' : 'Song Requests ausgeschaltet.'); }
    });
  };
  $('requests-settings-form').onsubmit = event => {
    event.preventDefault(); action(async (path, live) => {
      const data = await api(path, 'PATCH', settings()); if (live()) { render(data, true); notice('Einstellungen gespeichert.'); }
    });
  };
  $('requests-create-form').onsubmit = event => {
    event.preventDefault(); action(async (path, live) => {
      const reward = await api(`${path}/rewards`, 'POST', { title: $('requests-reward-title').value, cost: Number($('requests-reward-cost').value) });
      if (!live()) return;
      rewards = [...(rewards || []).filter(r => r.id !== reward.id), reward]; fillRewards(reward.id);
      notice('Reward erstellt und ausgewählt. Auswahl speichern oder Song Requests einschalten.');
    });
  };
  setInterval(poll, 2500);
  document.addEventListener('visibilitychange', poll);
  return { select(profileId) {
    id = profileId; revision++; state = undefined; rewards = undefined; busy = false; offline = false; historyKey = undefined;
    $('requests-enabled').checked = false; $('requests-config').hidden = true; $('requests-pairing').hidden = true;
    $('requests-disconnect').hidden = true; $('requests-recent').hidden = true; $('requests-twitch-form').hidden = true;
    $('requests-client-id').value = ''; $('requests-badge').textContent = '…'; $('requests-badge').removeAttribute('data-state');
    $('requests-status').textContent = 'Einstellungen werden geladen …'; notice(''); controls(); poll();
  } };
}
