import {SecureImage} from './SecureMedia';
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, ZoomOut, RotateCcw, X, ExternalLink } from 'lucide-react';

interface ImageZoomModalProps {
 isOpen: boolean;
 imageUrl: string;
 alt?: string;
 caption?: string;
 onClose: () => void;
}

export default function ImageZoomModal({
 isOpen,
 imageUrl,
 alt,
 caption,
 onClose,
}: ImageZoomModalProps) {
 const { t } = useTranslation();
 const [scale, setScale] = useState<number>(1);
 const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
 const [isDragging, setIsDragging] = useState<boolean>(false);
 const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
 const containerRef = useRef<HTMLDivElement>(null);

	// Lock background scroll when modal is open
	useEffect(() => {
		if (isOpen) {
			const originalOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			return () => {
				document.body.style.overflow = originalOverflow;
			};
		}
	}, [isOpen]);

 // Reset zoom & position when image changes or modal opens
 useEffect(() => {
 if (isOpen) {
 setScale(1);
 setPosition({ x: 0, y: 0 });
 }
 }, [isOpen, imageUrl]);

 // Keyboard navigation
 useEffect(() => {
 if (!isOpen) return;

 const handleKeyDown = (e: KeyboardEvent) => {
 if (e.key === 'Escape') {
 onClose();
 } else if (e.key === '+' || e.key === '=') {
 handleZoomIn();
 } else if (e.key === '-' || e.key === '_') {
 handleZoomOut();
 } else if (e.key === '0') {
 handleReset();
 }
 };

 window.addEventListener('keydown', handleKeyDown);
 return () => window.removeEventListener('keydown', handleKeyDown);
 }, [isOpen, scale]);

 if (!isOpen || !imageUrl) return null;

 const handleZoomIn = () => {
 setScale(prev => Math.min(prev + 0.5, 4));
 };

 const handleZoomOut = () => {
 setScale(prev => {
 const next = Math.max(prev - 0.5, 0.5);
 if (next <= 1) setPosition({ x: 0, y: 0 });
 return next;
 });
 };

 const handleReset = () => {
 setScale(1);
 setPosition({ x: 0, y: 0 });
 };

 const handleToggleZoom = (e: React.MouseEvent) => {
 e.stopPropagation();
 if (scale > 1) {
 handleReset();
 } else {
 setScale(2);
 }
 };

 // Dragging support when zoomed
 const handleMouseDown = (e: React.MouseEvent) => {
 if (scale > 1) {
 setIsDragging(true);
 setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
 }
 };

 const handleMouseMove = (e: React.MouseEvent) => {
 if (isDragging && scale > 1) {
 setPosition({
 x: e.clientX - dragStart.x,
 y: e.clientY - dragStart.y,
 });
 }
 };

 const handleMouseUp = () => {
 setIsDragging(false);
 };

 // Wheel zoom
 const handleWheel = (e: React.WheelEvent) => {
 e.preventDefault();
 if (e.deltaY < 0) {
 handleZoomIn();
 } else {
 handleZoomOut();
 }
 };

 return (
 <div 
 className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col items-center justify-between select-none animate-in fade-in duration-200"
 role="dialog"
 aria-modal="true"
 aria-label={caption || alt || t('image_enlarged')}
 onClick={onClose}
 onWheel={handleWheel}
 >
 {/* Top Toolbar */}
 <div 
 className="w-full max-w-7xl mx-auto p-4 flex items-center justify-between z-10"
 onClick={e => e.stopPropagation()}
 >
 <div className="flex items-center gap-3">
 <span className="text-white font-bold text-xs uppercase tracking-widest bg-black border-2 border-white/30 px-3 py-1.5">
 {t('image_zoom')} {Math.round(scale * 100)}%
 </span>
 {caption && (
 <p className="text-white/80 text-sm font-medium truncate max-w-md hidden sm:block">
 {caption}
 </p>
 )}
 </div>

 {/* Action controls */}
 <div className="flex items-center gap-2">
 {/* Zoom controls */}
 <div className="flex items-center bg-black border-2 border-white/30">
 <button
 type="button"
 onClick={handleZoomOut}
 disabled={scale <= 0.5}
 title={t('image_zoom_out')}
 aria-label={t('image_zoom_out')}
 className="p-2 text-white hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
 >
 <ZoomOut size={18} />
 </button>
 <button
 type="button"
 onClick={handleReset}
 title={t('image_zoom_reset')}
 aria-label={t('image_zoom_reset')}
 className="px-2.5 py-1 text-xs font-bold text-white hover:bg-white/15 transition-colors border-x border-white/20"
 >
 <RotateCcw size={15} />
 </button>
 <button
 type="button"
 onClick={handleZoomIn}
 disabled={scale >= 4}
 title={t('image_zoom_in')}
 aria-label={t('image_zoom_in')}
 className="p-2 text-white hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
 >
 <ZoomIn size={18} />
 </button>
 </div>

 {!imageUrl.startsWith('/api/media/') && <a
 href={imageUrl}
 target="_blank"
 rel="noopener noreferrer"
 title={t('image_open_original')}
 aria-label={t('image_open_original')}
 className="p-2 bg-black border-2 border-white/30 text-white hover:bg-white/15 transition-colors hidden sm:flex items-center justify-center"
 >
 <ExternalLink size={18} />
 </a>}

 {/* Close button */}
 <button
 type="button"
 onClick={onClose}
 title={t('ui_close')}
 aria-label={t('ui_close')}
 className="p-2 bg-brand-action text-white border-2 border-white/30 hover:scale-105 active:scale-95 transition-transform flex items-center justify-center"
 >
 <X size={20} />
 </button>
 </div>
 </div>

 {/* Main Image Container */}
 <div 
 ref={containerRef}
 className={`flex-1 w-full flex items-center justify-center overflow-hidden p-2 sm:p-6 ${scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
 onMouseDown={handleMouseDown}
 onMouseMove={handleMouseMove}
 onMouseUp={handleMouseUp}
 onMouseLeave={handleMouseUp}
 onClick={handleToggleZoom}
 >
 <SecureImage
 src={imageUrl}
 alt={alt || t('image_enlarged')}
 crossOrigin="anonymous"
 draggable={false}
 style={{
 transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
 transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
 }}
 className="max-h-[85vh] max-w-[90vw] object-contain border-4 border-black select-none"
 />
 </div>

 {/* Bottom Hint */}
 <div 
 className="p-3 text-center text-white/75 text-xs uppercase tracking-widest font-bold z-10 pointer-events-none"
 >
 {t(scale > 1 ? 'image_pan_hint' : 'image_zoom_hint')}
 </div>
 </div>
 );
}
