import styles from './Header.module.css';
import { SearchIcon } from './icons/icons';

export default function Header() {
  return (
    <header className={styles.header} data-testid="app-header">
      <SearchIcon className={styles.searchIcon} />
      <h1 className={styles.title}>Property Scout</h1>
    </header>
  );
}
