import '@testing-library/jest-dom';
import { configure } from '@testing-library/dom';
// Ignore <option> elements in getByText queries so table-cell clicks aren't
// ambiguous with identically-labelled filter dropdown options.
configure({ defaultIgnore: 'script, style, option' });
