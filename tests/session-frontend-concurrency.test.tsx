import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthenticationProvider, useAuthentication } from '../src/services/auth/AuthProvider';

function json(body: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function Harness() { const session = useAuthentication(); return <div><output data-testid="state">{session.state}</output><button onClick={() => void session.retry()}>Restore</button><button onClick={() => void session.signOut()}>Sign out</button></div>; }
afterEach(() => vi.unstubAllGlobals());
describe('browser-session concurrency', () => {
  it('restores the same server session independently in two tabs', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ user: { id: 'u-1', email: 'person@example.test' }, csrfToken: 'c'.repeat(43) }))); vi.stubGlobal('fetch', fetchMock);
    render(<><AuthenticationProvider><Harness /></AuthenticationProvider><AuthenticationProvider><Harness /></AuthenticationProvider></>);
    await waitFor(() => expect(screen.getAllByTestId('state').map(element => element.textContent)).toEqual(['authenticated', 'authenticated'])); expect(fetchMock).toHaveBeenCalledTimes(2); for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ credentials: 'include' });
  });
  it('does not let a restore response started before logout reinstall authenticated UI', async () => {
    let resolveRestore!: (response: Response) => void; const pendingRestore = new Promise<Response>(resolve => { resolveRestore = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ user: { id: 'u-1', email: 'person@example.test' }, csrfToken: 'c'.repeat(43) })).mockReturnValueOnce(pendingRestore).mockResolvedValueOnce(json({}, 204)); vi.stubGlobal('fetch', fetchMock);
    render(<AuthenticationProvider><Harness /></AuthenticationProvider>); expect(await screen.findByTestId('state')).toHaveTextContent('authenticated'); const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: 'Restore' })); await user.click(screen.getByRole('button', { name: 'Sign out' })); resolveRestore(json({ user: { id: 'u-1', email: 'person@example.test' }, csrfToken: 'c'.repeat(43) })); expect(await screen.findByTestId('state')).toHaveTextContent('signed-out'); expect(fetchMock.mock.calls[2][0]).toBe('/api/auth/logout'); expect(fetchMock.mock.calls[2][1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });
});
