import { Pipe, PipeTransform } from '@angular/core';

const fmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });

/** 2890 -> "2 890 ₴" */
@Pipe({ name: 'uah' })
export class UahPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    return `${fmt.format(Number(value))} ₴`;
  }
}
