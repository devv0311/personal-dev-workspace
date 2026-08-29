// First-slice UI. Vanilla JS, connected to the real API. No mock data.
// The only dev affordance is the "Acting as" principal switcher, which drives
// the DEV-ONLY Authorization header (P2.7 §5).

const KNOWN_PRINCIPALS = [
  { id: '00000000-0000-4000-8000-0000000000a1', label: 'Alice (owns the projects)' },
  { id: '00000000-0000-4000-8000-0000000000b0', label: 'Bob (member, no project access)' },
];

const state = {
  principalId: localStorage.getItem('dev.principalId') || KNOWN_PRINCIPALS[0].id,
  projectId: null,
};

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: `Dev ${state.principalId}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function showError(msg) {
  $('error-message').textContent = msg;
  $('error-view').hidden = false;
  $('project-view').hidden = true;
  $('placeholder').hidden = true;
}
function clearError() {
  $('error-view').hidden = true;
}

function renderPrincipalPicker() {
  const sel = $('principal');
  sel.innerHTML = '';
  for (const p of KNOWN_PRINCIPALS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    if (p.id === state.principalId) opt.selected = true;
    sel.append(opt);
  }
  sel.onchange = () => {
    state.principalId = sel.value;
    localStorage.setItem('dev.principalId', state.principalId);
    clearError();
    loadProjects().then(() => {
      if (state.projectId) openProject(state.projectId);
      else {
        $('project-view').hidden = true;
        $('placeholder').hidden = false;
      }
    });
  };
}

async function loadProjects() {
  const list = $('project-list');
  list.innerHTML = '<li class="muted">Loading…</li>';
  try {
    const { projects } = await api('/api/projects');
    list.innerHTML = '';
    if (projects.length === 0) {
      list.innerHTML = '<li class="muted">No projects visible to you.</li>';
      return;
    }
    for (const p of projects) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = p.title;
      btn.setAttribute('aria-current', String(p.id === state.projectId));
      btn.onclick = () => openProject(p.id);
      li.append(btn);
      list.append(li);
    }
  } catch (err) {
    list.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = `Could not load projects: ${err.message}`;
    list.append(li);
  }
}

function renderContext(view) {
  $('project-title').textContent = view.project.title;
  $('project-owner').textContent = `owner: ${view.project.ownerId.slice(0, 8)}…`;
  $('capture-count').textContent =
    view.captures.length === 1 ? '1 capture' : `${view.captures.length} captures`;

  const listEl = $('context-list');
  listEl.innerHTML = '';
  $('context-empty').hidden = view.captures.length > 0;

  for (const { object, anchoredBy } of view.captures) {
    const li = document.createElement('li');
    const h = document.createElement('h3');
    h.textContent = object.title || '(untitled note)';
    const body = document.createElement('p');
    body.textContent = object.body;
    const edge = document.createElement('span');
    edge.className = 'edge';
    const code = document.createElement('code');
    code.textContent = anchoredBy.verb;
    edge.append(code, document.createTextNode(' → this project'));
    if (anchoredBy.synthesised) {
      const note = document.createElement('span');
      note.textContent = ' (edge from home_project_id)';
      edge.append(note);
    }
    li.append(h);
    if (object.body) li.append(body);
    li.append(edge);
    listEl.append(li);
  }
}

async function openProject(id) {
  state.projectId = id;
  clearError();
  $('placeholder').hidden = true;
  try {
    const view = await api(`/api/projects/${id}`);
    $('project-view').hidden = false;
    renderContext(view);
    document.querySelectorAll('#project-list button').forEach((b) => {
      b.setAttribute('aria-current', String(b.textContent === view.project.title));
    });
  } catch (err) {
    if (err.status === 404) showError('That project is not available to you.');
    else showError(err.message);
  }
}

function wireCaptureForm() {
  const form = $('capture-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const status = $('capture-status');
    const submit = $('capture-submit');
    const title = $('note-title').value.trim();
    const body = $('note-body').value.trim();
    if (!title && !body) {
      status.textContent = 'Enter a title or a body.';
      status.className = 'err';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Saving…';
    status.className = '';
    try {
      // The UI reports success only AFTER authoritative persistence responds 201.
      await api(`/api/projects/${state.projectId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ title, body }),
      });
      $('note-title').value = '';
      $('note-body').value = '';
      status.textContent = 'Captured and persisted.';
      status.className = 'ok';
      await openProject(state.projectId); // re-read from persisted state
    } catch (err) {
      status.textContent = `Not saved: ${err.message}`;
      status.className = 'err';
    } finally {
      submit.disabled = false;
    }
  };
}

renderPrincipalPicker();
wireCaptureForm();
loadProjects();
