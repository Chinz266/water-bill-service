import { Body, Controller, Post } from '@nestjs/common';
import { MemberService } from 'src/service/member.service';
import { MemberRemoveDto } from 'src/dto/member-remove.dto';
import { CreateMemberDto } from 'src/dto/member-create.dto';

@Controller('member')
export class MemberController {
    constructor(private readonly memberService: MemberService) {}

    @Post('/all')
    findAll() {
        return this.memberService.findAll();
    }

    @Post('/find-one')
    findOne(@Body() userData: MemberRemoveDto) {
        return this.memberService.findOne(userData.id);
    }

    @Post('/create')
    create(@Body() userData: CreateMemberDto) {
        return this.memberService.create(userData);
    }

    @Post('/update')
    update(@Body() userData: CreateMemberDto) {
        return this.memberService.update(userData);
    }

    @Post('/remove')
    remove(@Body() userData: MemberRemoveDto) {
        return this.memberService.remove(userData);
    }
}
