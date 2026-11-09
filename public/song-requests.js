const $ = id => document.getElementById(id);
const time = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' });
const statusNames = { off: 'Aus', connecting: 'Verbindet', listening: 'Bereit', reconnecting: 'Verbindet erneut',
  error: 'Fehler', twitch_required: 'Twitch fehlt', spotify_required: 'Spotify fehlt', reward_required: 'Reward fehlt' };
const historyNames = { queued: 'Eingereiht', processing: 'Wird verarbeitet', rejected: 'Abgelehnt', unknown: 'Bitte prüfen' };
const demo = { titel: 'Night Drive', interpret: 'Island Demo', user: 'zuschauer' };
const tokenButtons = [...document.querySelectorAll('[data-template-token]')];

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
    for (const id of ['requests-disconnect', 'requests-cancel-pairing', 'requests-refresh-rewards', 'requests-create', 'requests-save', 'requests-save-chat', 'requests-template']) $(id).disabled = locked;
    for (const button of tokenButtons) button.disabled = locked;
    const reward = rewards?.find(r => r.id === option?.value);
    $('requests-reward-hint').textContent = reward ? reward.manageable ? 'Bei Erfolg wird die Einlösung bestätigt. Bei eindeutiger Ablehnung gibt Twitch die Punkte zurück.'
      : 'Island Now kann diesen Reward verwenden. Bestätigung oder Rückerstattung der Punkte erfolgt im Twitch-Dashboard.'
      : 'Nur aktive Rewards mit erforderlicher Texteingabe können als Trigger dienen.';
  }
  function render(data, inputs) {
    state = data; offline = false;
    const badge = $('requests-badge');
    const badgeText = statusNames[data.status] || 'Aus';
    if (badge.textContent !== badgeText) badge.textContent = badgeText;
    badge.dataset.state = data.status;
    $('requests-enabled').checked = data.enabled;
    const status = data.detail || (data.status === 'listening' ? `Wartet auf „${data.reward?.title}“ im Kanal @${data.twitchLogin}.`
      : data.status === 'connecting' ? 'Twitch-Trigger wird verbunden …'
      : !data.spotifyReady ? 'Spotify-Warteschlange freigeben, um Songs einzureihen.'
      : !data.twitchConnected ? 'Twitch verbinden, um Kanalpunkte einzulesen.'
      : data.enabled ? 'Reward und Verbindungen prüfen.'
      : data.reward ? `Schalte Song Requests ein, um auf „${data.reward.title}“ zu reagieren.`
      : 'Wähle einen Reward und schalte Song Requests ein.');
    if ($('requests-status').textContent !== status) $('requests-status').textContent = status;
    $('requests-spotify-state').textContent = data.spotifyReady ? 'Warteschlange freigegeben' : 'Warteschlange noch nicht freigegeben';
    $('requests-spotify-account').dataset.ready = data.spotifyReady;
    $('requests-spotify').hidden = data.spotifyReady;
    $('requests-twitch-state').textContent = data.twitchConnected ? `Verbunden als @${data.twitchLogin}` : data.pairing?.error || 'Nicht verbunden';
    $('requests-twitch-account').dataset.ready = data.twitchConnected;
    $('requests-disconnect').hidden = !data.twitchConnected;
    $('requests-twitch-form').hidden = data.twitchConnected || !!data.pairing?.code;
    $('requests-client-id').placeholder = data.hasTwitchClientId ? 'Gespeicherte Client-ID verwenden' : 'Client-ID deiner Twitch-App';
    $('requests-pairing').hidden = !data.pairing?.code;
    $('requests-code').textContent = data.pairing?.code || '';
    if (data.pairing?.url) $('requests-activate').href = data.pairing.url; else $('requests-activate').removeAttribute('href');
    $('requests-config').hidden = !data.twitchConnected;
    $('requests-reward-empty').hidden = data.twitchConnected;
    $('requests-chat-sender').textContent = data.twitchConnected ? `@${data.twitchLogin}` : 'Twitch-Kanal';
    if (!data.twitchConnected) rewards = undefined;
    if (inputs === 'all' || inputs === 'chat') { $('requests-template').value = data.template; preview(); }
    if (inputs === 'all' || inputs === 'reward') fillRewards(data.reward?.id || '');
    const key = JSON.stringify(data.recent);
    if (key !== historyKey) {
      historyKey = key;
      $('requests-history-empty').hidden = !!data.recent.length;
      $('requests-history').hidden = !data.recent.length;
      $('requests-history').replaceChildren(...data.recent.map(item => {
        const li = document.createElement('li'), label = document.createElement('strong'), meta = document.createElement('span');
        const copy = document.createElement('div'), badge = document.createElement('span');
        label.textContent = item.title ? `${item.title} – ${item.artist}` : 'Songwunsch';
        meta.textContent = `${time.format(item.at)} · @${item.user}${item.note ? ` · ${item.note}` : ''}`;
        badge.textContent = historyNames[item.status] || item.status; badge.className = 'status-badge request-badge';
        badge.dataset.state = item.status;
        copy.append(label, meta); li.append(copy, badge); return li;
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
      render(data, first ? 'all' : connected !== data.twitchConnected ? 'reward' : undefined);
      if (data.twitchConnected && !connected) loadRewards();
    } catch (error) {
      if (current === revision) {
        offline = true; $('requests-badge').textContent = 'Offline'; $('requests-badge').dataset.state = 'error';
        $('requests-status').textContent = 'Die lokale Anwendung antwortet nicht.'; controls();
      }
    }
    finally { if (pollId === current) pollId = null; }
  }
  const rewardSettings = () => ({ rewardId: $('requests-reward').value });
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
    const data = await api(`${path}/twitch-disconnect`, 'POST', {}); if (live()) render(data, 'reward');
  });
  $('requests-reward').onchange = controls;
  $('requests-refresh-rewards').onclick = () => loadRewards(true);
  $('requests-template').oninput = preview;
  for (const button of tokenButtons) button.onclick = () => {
    const field = $('requests-template'), text = `{${button.dataset.templateToken}}`;
    if (field.value.length + text.length - (field.selectionEnd - field.selectionStart) > field.maxLength) return;
    field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end'); field.focus(); preview();
  };
  $('requests-enabled').onchange = event => {
    const enabled = event.target.checked;
    action(async (path, live) => {
      const data = await api(path, 'PATCH', enabled ? { ...rewardSettings(), enabled } : { enabled });
      if (live()) { render(data, enabled ? 'reward' : undefined); notice(enabled ? 'Song Requests eingeschaltet.' : 'Song Requests ausgeschaltet.'); }
    });
  };
  $('requests-settings-form').onsubmit = event => {
    event.preventDefault(); action(async (path, live) => {
      const data = await api(path, 'PATCH', rewardSettings()); if (live()) { render(data, 'reward'); notice('Reward gespeichert.'); }
    });
  };
  $('requests-chat-form').onsubmit = event => {
    event.preventDefault(); const template = $('requests-template').value;
    action(async (path, live) => {
      const data = await api(path, 'PATCH', { template }); if (live()) { render(data, 'chat'); notice('Chatnachricht gespeichert.'); }
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
    $('requests-disconnect').hidden = true; $('requests-history').hidden = true; $('requests-history-empty').hidden = false; $('requests-twitch-form').hidden = true;
    $('requests-template').value = ''; $('requests-chat-sender').textContent = 'Twitch-Kanal'; preview();
    $('requests-reward-empty').hidden = false;
    $('requests-client-id').value = ''; $('requests-badge').textContent = '…'; $('requests-badge').removeAttribute('data-state');
    $('requests-status').textContent = 'Einstellungen werden geladen …'; notice(''); controls(); poll();
  } };
}
