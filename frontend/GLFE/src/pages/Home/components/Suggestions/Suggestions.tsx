import { suggestions } from '../../mock'
import styles from './Suggestions.module.css'

export default function Suggestions() {
    return (
        <div className={styles.box}>
            <div className={styles.head}>
                <div className={styles.title}>Gợi ý cho bạn</div>
                <div className={styles.all}>Xem tất cả</div>
            </div>

            <div className={styles.list}>
                {suggestions.map((s) => (
                    <div key={s.id} className={styles.row}>
                        <img className={styles.avatar} src={s.avatar} alt="avt" />
                        <div className={styles.meta}>
                            <div className={styles.name}>{s.name}</div>
                            <div className={styles.sub}>{s.sub}</div>
                        </div>
                        <div className={styles.follow}>Theo dõi</div>
                    </div>
                ))}
            </div>
        </div>
    )
}