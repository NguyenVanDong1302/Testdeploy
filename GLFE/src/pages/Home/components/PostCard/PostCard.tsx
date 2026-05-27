import styles from './PostCard.module.css'

export default function PostCard(props: {
    username: string
    time: string
    avatar: string
    image: string
    likes: number
    comments: number
}) {
    return (
        <article className={styles.card}>
            <header className={styles.header}>
                <img className={styles.avatar} src={props.avatar} alt="avt" />
                <div className={styles.title}>
                    <span className={styles.user}>{props.username}</span>
                    <span className={styles.dot}>•</span>
                    <span className={styles.time}>{props.time}</span>
                </div>
                <div className={styles.more}>…</div>
            </header>

            <div className={styles.media}>
                <img className={styles.photo} src={props.image} alt="post" />
            </div>

            <footer className={styles.footer}>
                <div className={styles.actions}>
                    <span className={styles.icon}>♡</span>
                    <span className={styles.icon}>💬</span>
                    <span className={styles.icon}>✈️</span>
                    <span className={styles.save}>🔖</span>
                </div>

                <div className={styles.counts}>
                    <span className={styles.mini}>❤️ {props.likes}</span>
                    <span className={styles.mini}>💬 {props.comments}</span>
                </div>
            </footer>
        </article>
    )
}