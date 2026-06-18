import PhotoAlbumRPA from "react-photo-album";
import type { RenderPhotoProps } from "react-photo-album";
import { getThumbUrl, getPreviewUrl, getOriginalUrl, type Post } from "@/lib/api";

// === Client-side Photo Card (for interactivity) ===

function PhotoCard({ photo, onClick }: { photo: Post; onClick: () => void }) {
  return (
    <a
      href={`/posts/${photo.id}`}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="group block rounded-xl overflow-hidden card"
    >
      <div className="relative overflow-hidden">
        <img
          src={getThumbUrl(photo)}
          alt={photo.title || `Post ${photo.id}`}
          width={photo.width}
          height={photo.height}
          loading="lazy"
          className="w-full h-auto object-cover transition-transform duration-300 group-hover:scale-105"
          style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
        />
        {/* Hover overlay with tags */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2">
          {photo.tags && photo.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {photo.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag.id}
                  className="text-xs px-1.5 py-0.5 rounded bg-white/20 text-white backdrop-blur-sm truncate max-w-[100px]"
                >
                  {tag.name}
                </span>
              ))}
              {photo.tags.length > 5 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-white/20 text-white backdrop-blur-sm">
                  +{photo.tags.length - 5}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </a>
  );
}

// === Client Island Wrapper ===

import { useState, useCallback } from "react";

interface PhotoAlbumClientProps {
  posts: Post[];
  columns?: number;
}

export default function PhotoAlbumClient({ posts, columns: defaultColumns }: PhotoAlbumClientProps) {
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  const handlePostClick = useCallback((post: Post) => {
    // Navigate to detail page
    window.location.href = `/posts/${post.id}`;
  }, []);

  const photos = posts.map((post) => ({
    src: getThumbUrl(post),
    width: post.width,
    height: post.height,
    alt: post.title || `Post ${post.id}`,
    post,
  }));

  return (
    <div className="photo-album-wrapper">
      <PhotoAlbumRPA
        photos={photos}
        layout="masonry"
        columns={(containerWidth) => {
          if (containerWidth < 640) return 2;
          if (containerWidth < 1024) return 3;
          if (containerWidth < 1400) return 4;
          return defaultColumns || 5;
        }}
        spacing={8}
        padding={0}
        renderPhoto={({ photo, layout }) => {
          const post = (photo as typeof photos[number]).post;
          return (
            <PhotoCard
              photo={post}
              onClick={() => handlePostClick(post)}
            />
          );
        }}
      />

      {/* Lightbox overlay */}
      {selectedPost && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setSelectedPost(null)}
        >
          <img
            src={getPreviewUrl(selectedPost)}
            alt={selectedPost.title || "Full image"}
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-2xl hover:text-[var(--color-cyan-accent-start)] transition-colors"
            onClick={() => setSelectedPost(null)}
            aria-label="Close lightbox"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}