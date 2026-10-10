import Image from "next/image";
import type { CSSProperties } from "react";

/*
 * The sign-in illustration: a still paper-cut factory with its smoke and clouds as separate cutouts, animated in CSS
 * (.puff, .drift in globals.css). Clouds drift only across the right half, clear of the sign-in card. Positions are
 * percentages of the illustration, so they track the chimneys at any width. Art sources: public/home/README.md.
 */

const CHIMNEYS = [
  { left: 60.5, top: 30, size: 6.5 },
  { left: 65, top: 34.4, size: 5.2 },
];
const PUFFS = ["/home/puff-1.webp", "/home/puff-3.webp", "/home/puff-2.webp"];
const PUFF_SECONDS = 6.5;

const CLOUDS = [
  { src: "/home/cloud-2.webp", top: 6, width: 12, seconds: 60, delay: -12, rest: 58 },
  { src: "/home/cloud-1.webp", top: 14, width: 8, seconds: 45, delay: -30, rest: 84 },
  { src: "/home/cloud-3.webp", top: 2, width: 10, seconds: 75, delay: -50, rest: 72 },
];

export function FactoryArt() {
  return (
    <div className="relative w-full aspect-[1920/1088] overflow-hidden [container-type:inline-size]">
      <Image
        src="/home/factory-simple.webp"
        alt="A simple paper-cut factory with two striped smokestacks and a lime flag on a hill above the sea"
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      {/* Fades the art's top edge into the flat paper above it (the header, or the stacked card below lg). */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[10%] bg-gradient-to-b from-paper to-transparent" />
      {CLOUDS.map((c) => (
        <Image
          key={c.src}
          src={c.src}
          alt=""
          width={420}
          height={240}
          className="drift absolute left-0 h-auto"
          style={{ top: `${c.top}%`, width: `${c.width}%`, animationDuration: `${c.seconds}s`, animationDelay: `${c.delay}s`, "--rest": `${c.rest}cqw` } as CSSProperties}
        />
      ))}
      {CHIMNEYS.map((ch, i) => (
        <div key={i} className="absolute h-0" style={{ left: `${ch.left}%`, top: `${ch.top}%`, width: `${ch.size}%` }}>
          {PUFFS.map((src, j) => (
            <Image
              key={src}
              src={src}
              alt=""
              width={260}
              height={240}
              className={`puff absolute bottom-0 left-0 w-full h-auto ${j === 0 ? "puff-rest" : ""}`}
              style={{ animationDuration: `${PUFF_SECONDS}s`, animationDelay: `${-(j * PUFF_SECONDS) / PUFFS.length - i * 1.1}s` } as CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
