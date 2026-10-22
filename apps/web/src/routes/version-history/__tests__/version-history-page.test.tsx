import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { VersionHistoryPage } from '../index';

/**
 * Version History page: tabs -> entity list -> version timeline -> compare /
 * frozen snapshot modal, plus the ?entity=&id=&v= deep link. Real SWR ->
 * apiClient -> fetch; only fetch is stubbed. (The pure diff engine has its own
 * suite in diff.test.ts.)
 */

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); });

const USER = { role: 'QA', permissions: ['VERSION_HISTORY_VIEW'] };

/** Shows the router's current search string, to assert deep-link params are cleared. */
function Url() { const l = useLocation(); return <output data-testid="url">{l.search}</output>; }
function Page() { return <><VersionHistoryPage /><Url /></>; }

const CP_LIST = { data: [
  { id: 'cp-1', name: 'Dry Storage', version: 3, description: 'Dryer-first profile' },
  { id: 'cp-2' },
] };

const CP_V1 = {
  name: 'Dry Storage', version: 1, status: 'DRAFT', flowMode: 'STRICT',
  stages: [
    { id: 's-start', nodeType: 'START', positionX: 0, positionY: 0, sortOrder: 0 },
    { id: 's-wash', nodeType: 'STAGE', stateKey: 'WASH_IN', positionX: 220, positionY: 0, sortOrder: 1 },
    { id: 's-chk1', nodeType: 'CHECKLIST', positionX: 0, positionY: 120, configuration: { checklistProfileName: 'Short list' } },
    { id: 's-chk2', nodeType: 'CHECKLIST', positionX: 220, positionY: 120 },
    { id: 's-anon', positionX: 440, positionY: 120 },
  ],
  connections: [{ id: 'c1', fromStageId: 's-start', toStageId: 's-wash' }],
};
const CP_V2 = {
  name: 'Dry Storage', version: 2, status: 'ACTIVE', flowMode: 'STRICT', lineageId: 'lin-1234567890',
  description: 'Adds a checklist', alarmOnForwardSkip: true,
  cleaningReasons: [{ key: 'PM', name: 'Preventive', requiresJustification: false }, { key: 'BD', label: 'Breakdown', requiresJustification: true }],
  stages: [
    { id: 's-start', nodeType: 'START', positionX: 0, positionY: 0, sortOrder: 0 },
    { id: 's-chk', nodeType: 'CHECKLIST', positionX: 220, positionY: 0, sortOrder: 2, configuration: { checklistProfileName: 'Pre-wash inspection checklist long name' } },
    { id: 's-dry', nodeType: 'STAGE', stateKey: 'DRY_IN', positionX: 440, positionY: 80, sortOrder: 1 },
    { id: 's-odd', nodeType: 'MYSTERY', positionX: 660, positionY: 0 },
    { id: 's-nopos', nodeType: 'END' },
  ],
  connections: [
    { id: 'c1', fromStageId: 's-start', toStageId: 's-chk', label: 'always' },
    { id: 'c2', fromStageId: 's-chk', toStageId: 's-dry' },
    { id: 'c3', fromStageId: 's-dry', toStageId: 's-gone' },
    { fromStageId: 's-dry', toStageId: 's-odd' },
  ],
};

function cpRoutes(extra: MockRoute[] = []): MockRoute[] {
  return [
    ...commonConfigRoutes(),
    ...extra,
    { path: '/api/filter-cleaning-profiles', body: CP_LIST },
    { path: '/api/filter-cleaning-profiles/cp-1/versions', body: { lineageId: 'lin-1234567890', versions: [
      { id: 'v2', versionNumber: 2, changeNotes: 'Added checklist', createdAt: '2026-10-10T08:30:00.000Z', createdBy: 'user-abcdef-123' },
      { id: 'v1', versionNumber: 1, changeNotes: null, createdAt: null, createdBy: null },
    ] } },
    { path: '/api/filter-cleaning-profiles/cp-1/versions/1', body: CP_V1 },
    { path: '/api/filter-cleaning-profiles/cp-1/versions/2', body: CP_V2 },
  ];
}

describe('Version History — cleaning profiles', () => {
  it('lists entities, opens a timeline, and compares v2 with v1 as two pipeline flows', async () => {
    const api = mockApi(cpRoutes());
    const { container } = renderPage(<Page />, { route: '/version-history', user: USER, api });

    expect(screen.getByText('Pick an entity on the left to see its version timeline.')).toBeInTheDocument();
    expect(await screen.findByText('2 Cleaning Profiles')).toBeInTheDocument();
    expect(api.calls('GET', '/api/filter-cleaning-profiles')[0].query.get('limit')).toBe('1000000');
    expect(screen.getByText('Dry Storage · v3')).toBeInTheDocument();
    expect(screen.getByText('(unnamed) · v?')).toBeInTheDocument();
    expect(screen.getByText('Dryer-first profile')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dry Storage · v3/ }));
    expect(await screen.findByRole('heading', { name: 'Dry Storage' })).toBeInTheDocument();
    expect(screen.getByText(/2 archived versions/)).toHaveTextContent('Lineage lin-1234…');
    expect(screen.getByText('— Added checklist')).toBeInTheDocument();
    expect(screen.getByText(/Archived 10\/10\/2026 08:30/)).toHaveTextContent('by user-abc…');
    // v1 has nothing to compare against
    expect(screen.getAllByRole('button', { name: /^Compare with v/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Compare with v1' }));
    expect(await screen.findByText('Before · v1')).toBeInTheDocument();
    expect(screen.getByText('After · v2')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getAllByText('5 nodes')).toHaveLength(2);
    // flow drawing: the after-flow skips the node without a position, draws 4 boxes,
    // labels STAGE by state key, CHECKLIST with its (truncated) profile name, unknown type by title case
    const svgs = container.querySelectorAll('svg[viewBox]');
    const after = svgs[svgs.length - 1];
    expect(after.querySelectorAll('rect')).toHaveLength(4);
    const texts = Array.from(after.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(['Start', 'Checklist', 'Pre-wash inspection ch…', 'DRY IN', 'Mystery']));
    // a connection to a node that is not drawn is skipped: 3 of the 4 draw
    expect(after.querySelectorAll('path[marker-end]')).toHaveLength(3);
    // before-flow: a short checklist name is not truncated, a checklist with no config has no sub-line,
    // a node with no type gets an empty label
    const beforeTexts = Array.from(svgs[svgs.length - 2].querySelectorAll('text')).map((t) => t.textContent);
    expect(beforeTexts).toEqual(['Start', 'WASH IN', 'Checklist', 'Short list', 'Checklist', '']);

    fireEvent.click(screen.getByRole('button', { name: 'Hide comparison' }));
    expect(screen.queryByText('Before · v1')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('the frozen snapshot modal renders the profile, its reasons, sorted stages and connections; raw JSON toggles', async () => {
    const api = mockApi(cpRoutes());
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Dry Storage · v3/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^v2/ }));

    expect(await screen.findByText('Frozen snapshot · v2')).toBeInTheDocument();
    expect(await screen.findByText('Adds a checklist')).toBeInTheDocument();
    expect(screen.getByText('lin-1234…')).toBeInTheDocument();
    expect(screen.getByText('Alarm: forward skip').nextSibling).toHaveTextContent('true');
    expect(screen.getByText('Alarm: backward jump').nextSibling).toHaveTextContent('false');
    expect(screen.getByText('Cleaning reasons (2)')).toBeInTheDocument();
    expect(screen.getByText('Preventive')).toBeInTheDocument();
    expect(screen.getByText('Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Justification required')).toBeInTheDocument();
    expect(screen.getByText('Pipeline stages (5)')).toBeInTheDocument();
    // stages sorted by sortOrder (missing = 0): START(0), MYSTERY(—/0), END(—/0), DRY_IN(1), CHECKLIST(2)
    const rows = screen.getByText('Pipeline stages (5)').parentElement!.querySelectorAll('tbody tr');
    expect(Array.from(rows).map((r) => r.querySelector('code')!.textContent)).toEqual(['START', 'MYSTERY', 'END', 'STAGE', 'CHECKLIST']);
    expect(rows[4]).toHaveTextContent('checklistProfileName');
    expect(screen.getByText('Connections (4)')).toBeInTheDocument();
    expect(screen.getByText('(always)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show raw JSON' }));
    expect(screen.getByText('Raw JSON')).toBeInTheDocument();
    expect(screen.getByText(/"lineageId": "lin-1234567890"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide raw JSON' }));
    expect(screen.queryByText('Raw JSON')).toBeNull();

    // a click inside the modal keeps it; × closes it
    fireEvent.click(screen.getByText('Frozen snapshot · v2'));
    expect(screen.getByText('Frozen snapshot · v2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(screen.queryByText('Frozen snapshot · v2')).toBeNull();
  });

  it('a minimal snapshot shows the empty states; the backdrop closes the modal', async () => {
    const api = mockApi(cpRoutes([{ path: '/api/filter-cleaning-profiles/cp-1/versions/1', body: {} }]));
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Dry Storage · v3/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^v1/ }));
    expect(await screen.findByRole('heading', { name: '(unnamed)' })).toBeInTheDocument();
    expect(screen.getByText('v?')).toBeInTheDocument();
    expect(screen.getByText('No saved flow layout for this version.')).toBeInTheDocument();
    expect(screen.getByText('No stages.')).toBeInTheDocument();
    expect(screen.getByText('No connections.')).toBeInTheDocument();
    expect(screen.queryByText(/Cleaning reasons/)).toBeNull();
    // Lineage / Flow mode render the em-dash placeholder
    expect(screen.getByText('Lineage').nextSibling).toHaveTextContent('—');
    fireEvent.click(screen.getByText('Frozen snapshot · v1').closest('.fixed') as HTMLElement);
    expect(screen.queryByText('Frozen snapshot · v1')).toBeNull();
  });

  it('list, timeline, comparison and snapshot each report a load failure', async () => {
    const api = mockApi([
      ...commonConfigRoutes(),
      { path: '/api/filter-cleaning-profiles', body: CP_LIST },
      { path: '/api/filter-cleaning-profiles/cp-2/versions', status: 500, body: { error: 'INTERNAL', message: 'versions exploded' } },
      { path: '/api/filter-cleaning-profiles/cp-1/versions', body: [{ versionNumber: 2 }] },
      { path: '/api/filter-cleaning-profiles/cp-1/versions/1', body: CP_V1 },
      { path: '/api/filter-cleaning-profiles/cp-1/versions/2', status: 404, body: { error: 'NOT_FOUND', message: 'v2 purged' } },
    ]);
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(await screen.findByRole('button', { name: /\(unnamed\) · v\?/ }));
    expect(await screen.findByText('Failed to load versions: versions exploded')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dry Storage · v3/ }));
    // an array response (no lineage) and a version with no notes/date/author
    expect(await screen.findByText('1 archived version')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare with v1' }));
    // only the newer snapshot fails: its error is the one reported
    expect(await screen.findByText('Failed to load snapshots: v2 purged')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^v2/ }));
    expect(await screen.findByText('Failed to load snapshot: v2 purged')).toBeInTheDocument();
  });

  it('shows loading placeholders, an empty list, and an entity with no archived versions', async () => {
    const api = mockApi([
      ...commonConfigRoutes(),
      { path: '/api/filter-cleaning-profiles', body: { data: [{ id: 'cp-9', name: 'Fresh', version: 1 }] } },
      { path: '/api/filter-cleaning-profiles/cp-9/versions', body: { versions: [] } },
      { path: '/api/checklist-profiles', body: { data: [] } },
    ]);
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Fresh · v1/ }));
    expect(screen.getByText('Loading version history…')).toBeInTheDocument();
    expect(await screen.findByText(/No archived versions yet/)).toBeInTheDocument();
    expect(screen.getByText(/0 archived versions/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Checklist Profiles' }));
    expect(await screen.findByText('No checklist profiles yet.')).toBeInTheDocument();
    // switching tabs drops the selection
    expect(screen.getByText('Pick an entity on the left to see its version timeline.')).toBeInTheDocument();
  });

  it('comparing against a snapshot that has no stages shows an empty flow', async () => {
    const api = mockApi(cpRoutes([{ path: '/api/filter-cleaning-profiles/cp-1/versions/1', body: { status: 'DRAFT' } }]));
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Dry Storage · v3/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Compare with v1' }));
    expect(await screen.findByText('0 nodes')).toBeInTheDocument();
    expect(screen.getByText('No saved flow layout for this version.')).toBeInTheDocument();
  });

  it('a failed entity list says so', async () => {
    const api = mockApi([...commonConfigRoutes(), { path: '/api/filter-cleaning-profiles', status: 500, body: { error: 'INTERNAL', message: 'list down' } }]);
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    expect(await screen.findByText('Failed to load: list down')).toBeInTheDocument();
  });
});

describe('Version History — checklist profiles (field-level diff)', () => {
  const PREV = {
    name: 'Pre-wash', versionNumber: 1, isActive: true,
    requiresJustification: false,
    retentionDays: 30,
    note: 'short',
    reviewedOn: '2026-10-01T09:00:00.000Z',
    tags: ['a', 'b'],
    owners: [{ name: 'Ravi' }, { label: 'QA' }, { key: 'k1' }, { other: 1 }],
    limits: { min: 1, strict: true, id: 'meta' },
    extra: { id: 'only-meta' },
    settings: { range: { lo: 1, strict: true, id: 'm' }, meta: { id: 'a' }, list: [1, 2], legacy: 'old-mode' },
    'odd key': 'x',
    questions: [
      { id: 'q1', question: 'Is the filter intact?', required: false },
      { id: 'q2', question: 'Gasket ok?' },
      { id: 'q3', description: 'Pressure note' },
    ],
  };
  const CURR = {
    name: 'Pre-wash', versionNumber: 2, isActive: false,
    requiresJustification: true,
    retentionDays: 45,
    note: 'L'.repeat(90),
    reviewedOn: '2026-10-05T14:15:00.000Z',
    tags: [],
    owners: ['Ravi'],
    limits: { min: 2, strict: false, id: 'meta' },
    extra: { id: 'changed-meta' },
    settings: { range: { lo: 2, strict: false, id: 'm' }, meta: { id: 'b' }, list: [1, 2] },
    'odd key': 'y',
    badDate: '2026-13-45T99:99:00',
    questions: [
      { id: 'q1', question: 'Is the filter intact?', required: true },
      { id: 'q3', description: 'Pressure note' },
      { id: 'q4', key: 'NEW_Q' },
      { id: 'q5', nodeType: 'SECTION_BREAK' },
      { id: 'q6xxxxxxxxxx' },
      { id: 7 },
    ],
  };
  const QS = [
    { id: 'qa', sortOrder: 2, question: 'Second question', questionType: 'YES_NO', required: true, section: 'Intake', options: ['Y', 'N'], description: 'Answer honestly' },
    { id: 'qb', sortOrder: 1, question: 'First question', type: 'TEXT', options: [] },
    { id: 'qc', question: 'Unordered question', questionType: 'NUMBER' },
  ];

  function routes(): MockRoute[] {
    return [
      ...commonConfigRoutes(),
      { path: '/api/filter-cleaning-profiles', body: { data: [] } },
      { path: '/api/checklist-profiles', body: { data: [{ id: 'cl-1', name: 'Pre-wash', version: 2 }, { id: 'cl-2', name: 'Same', version: 2 }, { id: 'cl-3' }] } },
      { path: '/api/checklist-profiles/cl-1/versions', body: [{ id: 'x2', version: 2 }, { id: 'x1', version: 1 }] },
      { path: '/api/checklist-profiles/cl-1/versions/1', body: PREV },
      { path: '/api/checklist-profiles/cl-1/versions/2', body: { ...CURR, questions: CURR.questions, description: 'Inspection before wash' } },
      { path: '/api/checklist-profiles/cl-2/versions', body: [{ id: 'y2', versionNumber: 2 }] },
      { path: '/api/checklist-profiles/cl-2/versions/1', body: { name: 'Same', versionNumber: 1 } },
      { path: '/api/checklist-profiles/cl-2/versions/2', body: { name: 'Same', versionNumber: 2, updatedAt: 'x' } },
    ];
  }

  it('lists changed / added / removed fields with readable paths and values', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(screen.getByRole('button', { name: 'Checklist Profiles' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pre-wash · v2/ }));
    // a checklist with no name or version is still listed, with placeholders
    expect(screen.getByRole('button', { name: '(unnamed) · v?' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Compare with v1' }));
    const list = (await screen.findByText('Requires justification')).closest('ul')!;
    const line = (path: string) => within(list).getByText(path).closest('li')!;

    expect(line('Active')).toHaveTextContent('ChangedActiveYes→No');
    expect(line('Requires justification')).toHaveTextContent('No→Yes');
    expect(line('Retention days')).toHaveTextContent('30→45');
    expect(line('Note')).toHaveTextContent(`short→${'L'.repeat(80)}…`);
    expect(line('Reviewed on')).toHaveTextContent('01/10/2026 09:00→05/10/2026 14:15');
    expect(line('Tags')).toHaveTextContent('a, b→(none)');
    expect(line('Owners')).toHaveTextContent('Ravi, QA, k1, {"other":1}→Ravi');
    // nested object: each changed key is its own line; META keys (id) never appear
    expect(line('Limits › Min')).toHaveTextContent('1→2');
    expect(line('Limits › Strict')).toHaveTextContent('Yes→No');
    expect(within(list).queryByText(/Extra/)).toBeNull();
    // an object value renders as readable key: value pairs, meta keys dropped; all-meta -> (empty)
    expect(line('Settings › Range')).toHaveTextContent('Lo: 1; Strict: Yes→Lo: 2; Strict: No');
    expect(line('Settings › Meta')).toHaveTextContent('(empty)→(empty)');
    // a nested key removed in v2; an equal nested array is not reported
    expect(line('Settings › Legacy')).toHaveTextContent('Removed');
    expect(line('Settings › Legacy').querySelector('.line-through')).toHaveTextContent('old-mode');
    expect(within(list).queryByText('Settings › List')).toBeNull();
    // a key that is not a plain identifier is shown verbatim
    expect(line('odd key')).toHaveTextContent('x→y');
    // an ISO-looking but invalid date stays as typed
    expect(line('Bad date')).toHaveTextContent('Added');
    expect(line('Bad date')).toHaveTextContent('2026-13-45T99:99:00');
    expect(line('Description')).toHaveTextContent('Inspection before wash');

    // keyed questions: field change inside q1, q2 removed, q4..q7 added with fallback labels
    expect(line('Questions “Is the filter intact?” › Required')).toHaveTextContent('No→Yes');
    const removed = line('Questions “Gasket ok?”');
    expect(removed).toHaveTextContent('Removed');
    expect(removed.querySelector('.line-through')).toHaveTextContent('Gasket ok?');
    expect(line('Questions “NEW_Q”')).toHaveTextContent('Added');
    expect(line('Questions “Section Break”')).toHaveTextContent('Added');
    expect(line('Questions “q6xxxxxx…”')).toHaveTextContent('Added');
    expect(line('Questions “?”')).toHaveTextContent('Added');
    expect(api.unmatched).toEqual([]);
  });

  it('a failed snapshot fetch inside the field diff says so', async () => {
    const api = mockApi([
      { path: '/api/checklist-profiles/cl-1/versions/2', status: 500, body: { error: 'INTERNAL', message: 'snapshot store offline' } },
      ...routes(),
    ]);
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(screen.getByRole('button', { name: 'Checklist Profiles' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pre-wash · v2/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Compare with v1' }));
    expect(await screen.findByText('Failed to load snapshots: snapshot store offline')).toBeInTheDocument();
  });

  it('identical snapshots (only meta differs) say there is nothing to diff', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(screen.getByRole('button', { name: 'Checklist Profiles' }));
    fireEvent.click(await screen.findByRole('button', { name: /Same · v2/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Compare with v1' }));
    expect(await screen.findByText('No diffable changes between v1 and v2.')).toBeInTheDocument();
  });

  it('the snapshot modal lists questions in order with type, section, options and badges', async () => {
    const api = mockApi([
      { path: '/api/checklist-profiles/cl-1/versions/2', body: { name: 'Pre-wash', versionNumber: 2, isActive: false, description: 'Inspection', questions: QS } },
      ...routes(),
    ]);
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(screen.getByRole('button', { name: 'Checklist Profiles' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pre-wash · v2/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^v2/ }));
    expect(await screen.findByText('Questions (3)')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('Question count').nextSibling).toHaveTextContent('3');
    const items = screen.getByText('Questions (3)').parentElement!.querySelectorAll('ol > li');
    expect(Array.from(items).map((li) => li.querySelector('.font-medium')!.textContent)).toEqual(['Unordered question', 'First question', 'Second question']);
    expect(items[0]).toHaveTextContent('#?');
    expect(items[1]).toHaveTextContent('Type: TEXT');
    expect(items[1]).not.toHaveTextContent('Options');
    expect(items[2]).toHaveTextContent('Required');
    expect(items[2]).toHaveTextContent('Section: Intake');
    expect(items[2]).toHaveTextContent('Options: 2');
    expect(items[2]).toHaveTextContent('Answer honestly');
  });

  it('a checklist snapshot with no questions says so (status defaults to Active)', async () => {
    const api = mockApi([
      { path: '/api/checklist-profiles/cl-1/versions/1', body: { name: 'Empty' } },
      ...routes(),
    ]);
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(screen.getByRole('button', { name: 'Checklist Profiles' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pre-wash · v2/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^v1/ }));
    expect(await screen.findByText('No questions.')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('v?')).toBeInTheDocument();
  });
});

describe('Version History — equipment groups', () => {
  const EG_V3 = {
    name: 'AHU-01 instruments', versionNumber: 3, blockId: 'blk-98765432',
    instruments: [
      { id: 'i2', stageKey: 'WASH_IN', sortOrder: 2, description: 'Air pressure', instrumentId: 'PG-2', serialNumber: 'SN2', uom: 'bar', operatingMin: 1, operatingMax: 3, instrumentMin: 0, instrumentMax: 10, leastCount: 0.1 },
      { id: 'i1', stageKey: 'WASH_IN', sortOrder: 1, description: 'Water pressure', instrumentId: 'PG-1', serialNumber: 'SN1', uom: 'bar', operatingMin: 2, operatingMax: 4, instrumentMin: 0, instrumentMax: 10, leastCount: 0.1 },
      { id: 'i3', description: 'Thermometer', instrumentId: 'TT-1' },
      { stageKey: 'DRY_IN', description: 'Dryer temp' },
    ],
  };

  function routes(): MockRoute[] {
    return [
      ...commonConfigRoutes(),
      { path: '/api/filter-cleaning-profiles', body: { data: [] } },
      { path: '/api/equipment-groups', body: [{ id: 'eg-1', name: 'AHU-01 instruments', version: 3 }, { id: 'eg-2' }] },
      { path: '/api/equipment-groups/eg-2/versions', body: { currentVersion: 1 } },
      { path: '/api/equipment-groups/eg-1/versions', body: { groupId: 'eg-1', currentVersion: 3, versions: [{ versionNumber: 3 }, { versionNumber: 2 }] } },
      { path: '/api/equipment-groups/eg-1/versions/3', body: EG_V3 },
      { path: '/api/equipment-groups/eg-1/versions/2', body: { name: 'AHU-01 instruments', versionNumber: 2, isActive: true, instruments: [{ id: 'i1', description: 'Water pressure', uom: 'psi' }] } },
    ];
  }

  it('the timeline shows the current version; compare diffs instruments by id', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(screen.getByRole('button', { name: 'Equipment Groups' }));
    expect(await screen.findByText('2 Equipment Groups')).toBeInTheDocument();
    // an unnamed group without a version; a versions payload without a list
    fireEvent.click(screen.getByRole('button', { name: '(unnamed) · v?' }));
    expect(await screen.findByText(/Current version/)).toHaveTextContent('Current version v1 · 0 archived versions');
    fireEvent.click(screen.getByRole('button', { name: /AHU-01 instruments · v3/ }));
    expect(await screen.findByText(/Current version/)).toHaveTextContent('Current version v3 · 2 archived versions');
    fireEvent.click(screen.getAllByRole('button', { name: /^Compare with v/ })[0]);
    const list = (await screen.findByText('Instruments “Water pressure” › Uom')).closest('ul')!;
    expect(within(list).getByText('Instruments “Water pressure” › Uom').closest('li')).toHaveTextContent('psi→bar');
    expect(within(list).getByText('Instruments “Air pressure”').closest('li')).toHaveTextContent('Added');
    expect(within(list).getByText('Instruments “Water pressure” › Operating min').closest('li')).toHaveTextContent('Added');
  });

  it('the snapshot groups instruments by stage (OTHER when unset), sorted within a stage', async () => {
    const api = mockApi(routes());
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(screen.getByRole('button', { name: 'Equipment Groups' }));
    fireEvent.click(await screen.findByRole('button', { name: /AHU-01 instruments · v3/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^v3/ }));
    expect(await screen.findByText('WASH_IN (2)')).toBeInTheDocument();
    expect(screen.getByText('OTHER (1)')).toBeInTheDocument();
    expect(screen.getByText('DRY_IN (1)')).toBeInTheDocument();
    expect(screen.getByText('blk-9876…')).toBeInTheDocument();
    expect(screen.getByText('Instruments').nextSibling).toHaveTextContent('4');
    const wash = screen.getByText('WASH_IN (2)').parentElement!.querySelectorAll('tbody tr');
    expect(Array.from(wash).map((r) => r.querySelector('td')!.textContent)).toEqual(['Water pressure', 'Air pressure']);
    expect(wash[0]).toHaveTextContent('2–4');
    expect(wash[0]).toHaveTextContent('0–10');
  });

  it('a group snapshot with no instruments and no block shows placeholders', async () => {
    const api = mockApi([{ path: '/api/equipment-groups/eg-1/versions/2', body: { name: 'Bare', versionNumber: 2 } }, ...routes()]);
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(screen.getByRole('button', { name: 'Equipment Groups' }));
    fireEvent.click(await screen.findByRole('button', { name: /AHU-01 instruments · v3/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^v2/ }));
    expect(await screen.findByRole('heading', { name: 'Bare' })).toBeInTheDocument();
    expect(screen.getByText('Block').nextSibling).toHaveTextContent('—');
    expect(screen.getByText('Instruments').nextSibling).toHaveTextContent('0');
  });
});

describe('Version History — deep link (?entity=&id=&v=)', () => {
  it('lands on the named tab with the entity selected and the snapshot open; a tab change clears the params', async () => {
    const api = mockApi([
      ...commonConfigRoutes(),
      { path: '/api/checklist-profiles', body: { data: [{ id: 'cl-abcdef123456', name: 'Deep', version: 4 }] } },
      { path: '/api/checklist-profiles/cl-abcdef123456/versions', body: [{ versionNumber: 2 }] },
      { path: '/api/checklist-profiles/cl-abcdef123456/versions/2', body: { name: 'Deep', versionNumber: 2, questions: [] } },
      { path: '/api/checklist-profiles/cl-abcdef123456/versions/1', body: { name: 'Deep', versionNumber: 1 } },
      { path: '/api/equipment-groups', body: [] },
    ]);
    renderPage(<Page />, { route: '/version-history?entity=checklist-profile&id=cl-abcdef123456&v=2', user: USER, api });
    expect(await screen.findByText('Frozen snapshot · v2')).toBeInTheDocument();
    // placeholder name from the id until the user picks from the list
    expect(screen.getByRole('heading', { name: 'cl-abcde…' })).toBeInTheDocument();
    expect(await screen.findByText('Deep · v4')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('?entity=checklist-profile');

    fireEvent.click(screen.getByRole('button', { name: '×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Equipment Groups' }));
    expect(await screen.findByText('No equipment groups yet.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^$/));
    expect(screen.queryByText('Frozen snapshot · v2')).toBeNull();
  });

  it('an id without a version selects the entity but opens no snapshot', async () => {
    const api = mockApi([
      ...commonConfigRoutes(),
      { path: '/api/equipment-groups', body: [] },
      { path: '/api/equipment-groups/eg-77777777/versions', body: { versions: [] } },
      { path: '/api/filter-cleaning-profiles', body: { data: [] } },
    ]);
    renderPage(<Page />, { route: '/version-history?entity=equipment-group&id=eg-77777777', user: USER, api });
    expect(await screen.findByRole('heading', { name: 'eg-77777…' })).toBeInTheDocument();
    expect(screen.queryByText(/Frozen snapshot/)).toBeNull();
    // a tab click with no deep-link params left leaves the URL alone
    fireEvent.click(screen.getByRole('button', { name: 'Cleaning Profiles' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^$/));
    fireEvent.click(screen.getByRole('button', { name: 'Cleaning Profiles' }));
    expect(await screen.findByText('No cleaning profiles yet.')).toBeInTheDocument();
  });

  it('an unknown entity in the URL falls back to the Cleaning Profiles tab and selects nothing', async () => {
    const api = mockApi([...commonConfigRoutes(), { path: '/api/filter-cleaning-profiles', body: { data: [] } }]);
    renderPage(<Page />, { route: '/version-history?entity=filter-profile&id=fp-1&v=1', user: USER, api });
    expect(await screen.findByText('No cleaning profiles yet.')).toBeInTheDocument();
    expect(screen.getByText('Pick an entity on the left to see its version timeline.')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });
});

describe('Version History — accessibility + console', () => {
  it('scans the page with the snapshot modal open; nothing is logged', async () => {
    const api = mockApi(cpRoutes());
    renderPage(<Page />, { route: '/version-history', user: USER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Dry Storage · v3/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^v2/ }));
    await screen.findByText('Adds a checklist');
    const unl = unlabeledControls();
    expect(unl.none).toEqual([]);
    expect(unl.placeholderOnly).toEqual([]);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
  });
});
