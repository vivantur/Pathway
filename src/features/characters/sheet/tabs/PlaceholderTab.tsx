import type { SVGProps } from 'react';
import { Panel } from '../Sheet';

/**
 * "Coming soon" content for tabs we haven't built deep views for yet.
 * Explains what will eventually live there so it doesn't feel broken.
 */
export function PlaceholderTab({
  label,
  description,
  Icon,
}: {
  label: string;
  description: string;
  Icon: (props: SVGProps<SVGSVGElement> & { className?: string }) => JSX.Element;
}) {
  return (
    <div className="space-y-4">
      <Panel title={label} icon={<Icon />}>
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <div className="rounded-full border border-gold/30 bg-midnight-900/60 p-5 text-gold/60">
            <Icon className="text-4xl" />
          </div>
          <div>
            <h3 className="font-display text-xl text-gold">Coming Soon</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-silver/70">
              {description}
            </p>
          </div>
          <p className="text-xs text-silver/40">
            For now, check the <span className="text-silver/70">Overview</span> tab —
            it condenses this content into the main sheet.
          </p>
        </div>
      </Panel>
    </div>
  );
}
