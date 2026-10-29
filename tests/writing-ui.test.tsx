import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ listWritingProjects: vi.fn(), getWritingProject: vi.fn(), generateWritingOutline: vi.fn(), createWritingProject: vi.fn(), createWritingChapter: vi.fn(), generateWritingChapter: vi.fn(), exportWritingProject: vi.fn() }));
vi.mock('../src/services/api/client', async importOriginal => ({ ...(await importOriginal<typeof import('../src/services/api/client')>()), ...mocks }));
import { WritingWorkspace } from '../src/features/writing/WritingWorkspace';
const project = { id: 'project-1', title: 'Moonlit Road', brief: { premise: 'A journey' }, status: 'draft', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z', chapters: [] };
describe('writing workspace', () => {
  it('loads an owner project, creates a reviewable outline and keeps chapter creation explicit', async () => {
    mocks.listWritingProjects.mockResolvedValue([project]); mocks.getWritingProject.mockResolvedValue(project); mocks.generateWritingOutline.mockResolvedValue({ ...project, outline: '1. Arrival' }); const user = userEvent.setup(); render(<WritingWorkspace />);
    expect(await screen.findByText('Moonlit Road')).toBeInTheDocument(); await user.click(screen.getByRole('button', { name: 'Moonlit Road draft' })); await waitFor(() => expect(mocks.getWritingProject).toHaveBeenCalledWith('project-1')); await user.click(screen.getByRole('button', { name: 'Generate outline' })); await waitFor(() => expect(mocks.generateWritingOutline).toHaveBeenCalledWith('project-1')); expect(mocks.createWritingChapter).not.toHaveBeenCalled();
  });
});
