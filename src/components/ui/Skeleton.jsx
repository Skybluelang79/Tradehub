import './Skeleton.css';

export function Skeleton({ width = '100%', height = 20, borderRadius = 8, className = '' }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius }}
    />
  );
}

export function ItemCardSkeleton() {
  return (
    <div className="item-card-skeleton">
      <Skeleton height="100%" borderRadius="12px" />
      <div className="item-card-skeleton-content">
        <Skeleton height={16} width="90%" />
        <Skeleton height={16} width="60%" />
        <div className="item-card-skeleton-footer">
          <Skeleton height={20} width={60} />
          <Skeleton height={14} width={40} />
        </div>
      </div>
    </div>
  );
}

export function ItemGridSkeleton({ count = 6 }) {
  return (
    <div className="items-grid-skeleton">
      {[...Array(count)].map((_, i) => (
        <ItemCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ConversationSkeleton() {
  return (
    <div className="conversation-skeleton">
      <Skeleton width={50} height={50} borderRadius="50%" />
      <div className="conversation-skeleton-content">
        <Skeleton height={14} width="40%" />
        <Skeleton height={12} width="70%" />
      </div>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="profile-skeleton">
      <Skeleton width={100} height={100} borderRadius="50%" />
      <Skeleton height={24} width={150} />
      <Skeleton height={16} width={100} />
      <div className="profile-skeleton-stats">
        <Skeleton height={40} width={60} />
        <Skeleton height={40} width={60} />
        <Skeleton height={40} width={60} />
      </div>
    </div>
  );
}
