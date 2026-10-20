export default function Legend() {
  return (
    <div className="panel legend">
      <div className="lg">
        <div className="sw" style={{ background: '#7fd4e8' }} />
        浅水
      </div>
      <div className="lg">
        <div className="sw" style={{ background: '#14507a' }} />
        深水
      </div>
      <div className="lg">
        <div className="sw" style={{ background: '#f0c040' }} />
        变电站
      </div>
      <div className="lg">
        <div className="sw" style={{ background: '#38d9d9' }} />
        水泵
      </div>
    </div>
  );
}
