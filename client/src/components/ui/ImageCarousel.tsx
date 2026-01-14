import { useState, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

interface ImageCarouselProps {
  images: string[];
  alt?: string;
  className?: string;
  imageClassName?: string;
  showDots?: boolean;
  showArrows?: boolean;
}

/**
 * Reusable image carousel component with navigation arrows and dot indicators.
 * Displays one image at a time with smooth transitions.
 */
export function ImageCarousel({
  images,
  alt = "Image",
  className = "",
  imageClassName = "",
  showDots = true,
  showArrows = true,
}: ImageCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const handlePrevious = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
    },
    [images.length]
  );

  const handleNext = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    },
    [images.length]
  );

  const goToIndex = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setCurrentIndex(index);
  }, []);

  // If no images, show placeholder
  if (!images || images.length === 0) {
    return (
      <div
        className={cn(
          "w-full h-48 bg-gray-100 rounded-xl flex items-center justify-center",
          className
        )}
      >
        <span className="text-4xl">📦</span>
      </div>
    );
  }

  // If only one image, show without controls
  if (images.length === 1) {
    return (
      <img
        src={images[0]}
        alt={alt}
        className={cn(
          "w-full h-48 object-cover rounded-xl",
          className,
          imageClassName
        )}
      />
    );
  }

  return (
    <div className={cn("relative group", className)}>
      {/* Main Image */}
      <img
        src={images[currentIndex]}
        alt={`${alt} ${currentIndex + 1}`}
        className={cn(
          "w-full h-48 object-cover rounded-xl transition-opacity duration-300",
          imageClassName
        )}
      />

      {/* Navigation Arrows */}
      {showArrows && (
        <>
          <button
            onClick={handlePrevious}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/40 hover:bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/40 hover:bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Next image"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Dot Indicators */}
      {showDots && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={(e) => goToIndex(e, index)}
              className={cn(
                "w-2 h-2 rounded-full transition-all",
                index === currentIndex
                  ? "bg-white scale-110"
                  : "bg-white/50 hover:bg-white/75"
              )}
              aria-label={`Go to image ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Image Counter Badge */}
      <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs rounded-full">
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  );
}
