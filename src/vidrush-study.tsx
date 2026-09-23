import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {VidrushMotion, type VidrushMotionEvent} from './vidrush-motion';

/**
 * Render-only study used for strict visual review. It deliberately cycles
 * through mechanisms seen in the reference corpus instead of demonstrating
 * the old lower-third/card collection.
 */
const STUDY: Array<VidrushMotionEvent & {frames: number}> = [
  {
    type: 'vidrush_evidence_matrix', frames: 116, duration: 3.87,
    title: 'One story, two lived realities.', kicker: 'LONDON BURNING', subtitle: 'FAMILIES QUEUING',
    image: 'showcase_img1.jpg', image2: 'showcase_img2.jpg', accent: '#cba65e',
  },
  {
    type: 'vidrush_dossier_compare', frames: 122, duration: 4.07,
    title: 'Someone rewrote the story.', kicker: 'ORIGINAL / SEP 2016', subtitle: 'AMENDED / FEB 2017',
    image: 'showcase_img1.jpg', accent: '#cb9e49',
  },
  {
    type: 'vidrush_identity_cutout', frames: 116, duration: 3.87,
    title: 'Harold & Helen Kite', kicker: 'A NAME EARNED', subtitle: 'The story behind the name.',
    image: 'showcase_img1.jpg', accent: '#ef2f73',
  },
  {
    type: 'vidrush_inspector_lens', frames: 122, duration: 4.07,
    title: 'ROLLER-DELAYED BOLT', image: 'showcase_img1.jpg',
    accent: '#d7ca8f', targetX: .39, targetY: .38,
  },
  {
    type: 'vidrush_cross_section', frames: 124, duration: 4.13,
    title: 'The ground does the cooling.', subtitle: 'air route / sectional drawing', accent: '#f0c927',
  },
  {
    type: 'vidrush_field_profile', frames: 116, duration: 3.87,
    title: 'Van Clothier', kicker: 'FIELD NOTE / PROFILE', subtitle: 'ARROYO RESTORATIONIST',
    image: 'showcase_img1.jpg', accent: '#e5dfd0',
  },
  {
    type: 'vidrush_archive_date', frames: 106, duration: 3.53,
    title: 'AUGUST 1565', kicker: 'HISTORICAL TURNING POINT', subtitle: 'A date that changed the coast forever.',
    image: 'showcase_img1.jpg', accent: '#ebc838',
  },
  {
    type: 'vidrush_evidence_gallery', frames: 126, duration: 4.2,
    title: 'A stake against the flood.', items: ['BEFORE', 'AFTER', 'FIELD NOTE'],
    image: 'showcase_img1.jpg', image2: 'showcase_img2.jpg', accent: '#e9e3d5',
  },
];

export const VIDRUSH_STUDY_FRAMES = STUDY.reduce((sum, scene) => sum + scene.frames, 0);

export const VidrushReferenceStudy: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{background: '#090909'}}>
      {STUDY.map((scene, index) => {
        const from = at;
        at += scene.frames;
        return (
          <Sequence key={`${scene.type}-${index}`} from={from} durationInFrames={scene.frames}>
            <VidrushMotion event={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
