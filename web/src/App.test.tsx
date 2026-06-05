import { render, screen } from '@testing-library/react';
import { App } from './App.js';

it('renders the app title', () => {
  render(<App />);
  expect(screen.getByText('Arena Match Viewer')).toBeInTheDocument();
});
