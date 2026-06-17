import { Body, Controller, Post } from '@nestjs/common';
import { MeterReadingService } from 'src/service/meter-reading.service';
import { MeterReadingCreateDto } from 'src/dto/meter-reading-create.dto';
import { MeterReadingRemoveDto } from 'src/dto/meter-reading-remove.dto';

@Controller('meter-reading')
export class MeterReadingController {
    constructor(private readonly meterReadingService: MeterReadingService) {}

    @Post('/all')
    findAll() {
        return this.meterReadingService.findAll();
    }

    @Post('/find-one')
    findOne(@Body() data: MeterReadingRemoveDto) {
        return this.meterReadingService.findOne(data.id);
    }

    @Post('/create')
    create(@Body() data: MeterReadingCreateDto) {
        return this.meterReadingService.create(data);
    }

    @Post('/update')
    update(@Body() data: MeterReadingCreateDto) {
        return this.meterReadingService.update(data);
    }

    @Post('/remove')
    remove(@Body() data: MeterReadingRemoveDto) {
        return this.meterReadingService.remove(data);
    }
}
