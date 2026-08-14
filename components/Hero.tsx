import styles from './Hero.module.css';

export default function Hero() {
  return (
    <section className={styles.hero} data-testid="hero">
      <h2 className={styles.headline}>Find your perfect home</h2>
      <p className={styles.subtitle}>Discover available rentals curated for you.</p>
    </section>
  );
}
