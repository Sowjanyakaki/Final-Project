import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SearchIcon, HeartIcon, BedIcon, SqftIcon, MicIcon, HouseIcon, PersonIcon } from './icons';

describe('icons', () => {
  it.each([
    ['SearchIcon', SearchIcon],
    ['HeartIcon', HeartIcon],
    ['BedIcon', BedIcon],
    ['SqftIcon', SqftIcon],
    ['MicIcon', MicIcon],
    ['HouseIcon', HouseIcon],
    ['PersonIcon', PersonIcon],
  ] as const)('%s renders an svg element', (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('SearchIcon applies a passed className to the svg', () => {
    const { container } = render(<SearchIcon className="my-icon" />);
    expect(container.querySelector('svg')).toHaveClass('my-icon');
  });
});
