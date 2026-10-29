import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceProvider } from '../src/app/WorkspaceContext';
import { AgentsWorkspace } from '../src/features/agents/AgentsWorkspace';

describe('agents workspace', () => {
  it('validates and locally saves an agent', async () => {
    const user = userEvent.setup();
    render(<WorkspaceProvider><AgentsWorkspace onStartChat={vi.fn()} /></WorkspaceProvider>);
    await user.click(screen.getAllByRole('button', { name: /create agent/i })[0]);
    await user.type(screen.getByLabelText(/^Name/), 'Research guide');
    await user.type(screen.getByLabelText(/^Short description/), 'A focused research assistant');
    await user.type(screen.getByLabelText(/^Detailed purpose/), 'Help plan and assess research questions.');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(await screen.findByRole('heading', { name: 'Research guide' })).toBeInTheDocument();
    expect(screen.getByText('Local configuration')).toBeInTheDocument();
  });

  it('duplicates, favorites, and deletes a local agent with confirmation', async () => {
    const user = userEvent.setup();
    render(<WorkspaceProvider><AgentsWorkspace onStartChat={vi.fn()} /></WorkspaceProvider>);
    await user.click(screen.getAllByRole('button', { name: /create agent/i })[0]);
    await user.type(screen.getByLabelText(/^Name/), 'Planner');
    await user.type(screen.getByLabelText(/^Short description/), 'A focused planning assistant');
    await user.type(screen.getByLabelText(/^Detailed purpose/), 'Help structure and review project plans.');
    await user.click(screen.getByRole('button', { name: 'Save agent' }));
    await user.click(screen.getByRole('button', { name: 'Favorite Planner' }));
    expect(screen.getByRole('button', { name: 'Unfavorite Planner' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Duplicate Planner' }));
    expect(await screen.findByRole('heading', { name: 'Planner copy' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete Planner' }));
    expect(screen.getByRole('dialog', { name: 'Delete local agent?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete agent' }));
    expect(screen.queryByRole('heading', { name: 'Planner' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planner copy' })).toBeInTheDocument();
  });
});
