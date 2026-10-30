import { Pipe, type PipeTransform } from '@angular/core';
import { preorderWhen } from '../core/labels';

/** Pre-order ETA: `'2026-11-14' | eta` → «очікується ~14 листопада». */
@Pipe({ name: 'eta' })
export class EtaPipe implements PipeTransform {
  transform(eta: string | null | undefined, short = false): string {
    return preorderWhen(eta, short);
  }
}
