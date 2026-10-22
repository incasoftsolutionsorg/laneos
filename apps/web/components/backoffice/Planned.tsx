import { Card, PageHeader } from '@laneos/ui';

const FIGMA = 'https://www.figma.com/design/TchUnJAKdMTE5RnusARL4l/Lane-OS-POS-System?node-id=';

/** A screen that is designed but not built yet. Says so plainly and links to its Figma frame. */
export function Planned({ title, frame, milestone, what }: { title: string; frame: string; milestone: string; what: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card className="flex max-w-2xl flex-col gap-3 p-6">
        <p className="text-[15px] font-semibold">Not built yet — planned for {milestone}</p>
        <p className="text-[13px] text-text-muted">{what}</p>
        <a href={`${FIGMA}${frame}`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-brand-primary">
          Open the design in Figma (frame {frame}) ↗
        </a>
      </Card>
    </>
  );
}
