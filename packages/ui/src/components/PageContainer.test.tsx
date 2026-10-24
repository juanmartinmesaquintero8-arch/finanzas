import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContainer } from './PageContainer';

describe('PageContainer', () => {
  it('envuelve el contenido en un <main>', () => {
    render(<PageContainer>hola</PageContainer>);
    expect(screen.getByRole('main')).toHaveTextContent('hola');
  });
});
