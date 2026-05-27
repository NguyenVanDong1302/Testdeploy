import Suggestions from "../../../pages/Home/components/Suggestions/Suggestions";
import styles from "./RightPanel.module.css";

export default function RightPanel() {
    return (
        <div className={styles.wrap}>
            <div className={styles.me}>
                <div className={styles.meLeft}>
                    <div className={styles.meAvatar} />
                    <div>
                        <div className={styles.meUser}>cute_hot_me05</div>
                        <div className={styles.meName}>Cute Họt Me</div>
                    </div>
                </div>
                <div className={styles.switch}>Chuyển</div>
            </div>

            {/* <Suggestions /> */}

            <div className={styles.footer}>
                Giới thiệu · Trợ giúp · Báo chí · API · Việc làm ·<br />
                Quyền riêng tư · Điều khoản · Vị trí · Ngôn ngữ ·<br />
                Meta đã xác minh<br /><br />
                {/* © 2026 T FROM META */}
            </div>
        </div>
    );
}